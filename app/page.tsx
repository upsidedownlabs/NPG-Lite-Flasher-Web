'use client';

import { useState, useRef, useEffect } from 'react';
import { ESPLoader, Transport } from 'esptool-js';
import { AppTour } from './components/AppTour';

// IndexedDB utility functions
const DB_NAME = 'ESP32FlasherDB';
const DB_VERSION = 2;
const STORE_NAME = 'firmwares';

const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      const oldVersion = event.oldVersion;

      if (oldVersion < 2 && db.objectStoreNames.contains(STORE_NAME)) {
        db.deleteObjectStore(STORE_NAME);
      }

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'name' });
        store.createIndex('timestamp', 'timestamp', { unique: false });
        store.createIndex('size', 'size', { unique: false });
      }
    };
  });
};

const saveFirmwareToDB = async (name: string, data: ArrayBuffer): Promise<void> => {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      const firmware = {
        name,
        data,
        timestamp: Date.now(),
        size: data.byteLength
      };

      const request = store.put(firmware);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } catch (error) {
    console.error('Database save error:', error);
    try {
      await resetDatabase();
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);

        const firmware = {
          name,
          data,
          timestamp: Date.now(),
          size: data.byteLength
        };

        const request = store.put(firmware);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
      });
    } catch (retryError: unknown) {
      throw new Error('Failed to save firmware to storage. Please clear your browser cache and try again.');
    }
  }
};

const resetDatabase = async (): Promise<void> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      console.warn('Database deletion blocked');
      resolve();
    };
  });
};

const getFirmwareFromDB = async (name: string): Promise<ArrayBuffer | null> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);

    const request = store.get(name);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      if (request.result) {
        resolve(request.result.data);
      } else {
        resolve(null);
      }
    };
  });
};

interface FirmwareInfo {
  name: string;
  size: number;
  timestamp: number;
}

const getAllFirmwaresFromDB = async (): Promise<FirmwareInfo[]> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);

    const request = store.getAll();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const firmwares = request.result.map((item: FirmwareInfo & { data: ArrayBuffer }) => ({
        name: item.name,
        size: item.size,
        timestamp: item.timestamp
      }));
      resolve(firmwares);
    };
  });
};

const deleteFirmwareFromDB = async (name: string): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    const request = store.delete(name);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
};

interface ExtendedESPLoader extends ESPLoader {
  readMac?(): Promise<string>;
  hardReset?(): Promise<void>;
}

interface GithubFirmware {
  name: string;
  url: string;
}

interface GithubAsset {
  name: string;
  browser_download_url: string;
}

interface GithubRelease {
  assets: GithubAsset[];
}

export default function ESP32Flasher() {
  const [isConnected, setIsConnected] = useState(false);
  const [isFlashing, setIsFlashing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [firmwareFile, setFirmwareFile] = useState<File | null>(null);
  const [chipInfo, setChipInfo] = useState<string>('');
  const [flashAddress, setFlashAddress] = useState<string>('0x10000');
  const [showGithubDialog, setShowGithubDialog] = useState(false);
  const [showAddFirmwareDialog, setShowAddFirmwareDialog] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [githubFirmwares, setGithubFirmwares] = useState<GithubFirmware[]>([]);
  const [isFetchingGithub, setIsFetchingGithub] = useState(false);
  const [downloadingFirmware, setDownloadingFirmware] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<string>('');
  const [localFirmwares, setLocalFirmwares] = useState<FirmwareInfo[]>([]);

  const transportRef = useRef<Transport | null>(null);
  const espLoaderRef = useRef<ExtendedESPLoader | null>(null);
  const serialPortRef = useRef<SerialPort | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const githubRepo = 'upsidedownlabs/npg-lite-firmware';
  const lastLogRef = useRef<HTMLDivElement>(null);
  const advancedButtonRef = useRef<HTMLButtonElement>(null);

  const addLog = (message: string) => {
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${message}`]);
  };

  useEffect(() => {
    if (lastLogRef.current) {
      lastLogRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  const loadLocalFirmwares = async () => {
    try {
      const firmwares = await getAllFirmwaresFromDB();
      setLocalFirmwares(firmwares);
    } catch (error) {
      console.error('Error loading local firmwares:', error);
    }
  };

  useEffect(() => {
    loadLocalFirmwares();
  }, []);

  // Prevent scrolling
  useEffect(() => {
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';

    return () => {
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
    };
  }, []);

  // Close advanced popup when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const el = target instanceof Element ? target : (target as Node).parentElement;

      if (
        showAdvanced &&
        advancedButtonRef.current &&
        !advancedButtonRef.current.contains(target) &&
        !(el instanceof Element && el.closest('.advanced-popup'))
      ) {
        setShowAdvanced(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showAdvanced]);
  const connectToDevice = async () => {
    try {
      // Check for Web Serial API support
      const navigatorWithSerial = navigator as Navigator & { serial?: Serial };
      if (!navigatorWithSerial.serial || typeof navigatorWithSerial.serial.requestPort !== 'function') {
        addLog('❌ Web Serial API not supported. Use Chrome/Edge 89+ over HTTPS.');
        return;
      }

      addLog('Requesting serial port access...');
      const port = await navigatorWithSerial.serial.requestPort();
      addLog('Connecting to ESP32...');

      serialPortRef.current = port;
      const transport = new Transport(port, true);
      transportRef.current = transport;

      const esploader = new ESPLoader({
        transport,
        baudrate: 921600,
        romBaudrate: 115200,
        terminal: {
          clean: () => { },
          writeLine: (data: string) => addLog(data),
          write: (data: string) => addLog(data)
        }
      }) as ExtendedESPLoader;

      espLoaderRef.current = esploader;
      const chip = await esploader.main();

      addLog(`Connected to ${chip}`);
      setChipInfo(chip);
      setIsConnected(true);

      try {
        const esploaderAny = esploader as unknown as { readMac?: () => Promise<string> };
        if (typeof esploaderAny.readMac === 'function') {
          const macAddr = await esploaderAny.readMac();
          addLog(`MAC Address: ${macAddr}`);
        }
      } catch (e: unknown) {
        // MAC read not critical
        console.log('MAC address read failed:', e);
      }

    } catch (error: unknown) {
      addLog(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      transportRef.current = null;
      espLoaderRef.current = null;
      serialPortRef.current = null;
    }
  };

  const disconnectDevice = async () => {
    try {
      if (transportRef.current) {
        await transportRef.current.disconnect();
      }
      if (serialPortRef.current && serialPortRef.current.readable) {
        await serialPortRef.current.close();
      }
      addLog('Disconnected from device');
    } catch (error: unknown) {
      addLog(`Disconnect warning: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      serialPortRef.current = null;
      transportRef.current = null;
      espLoaderRef.current = null;
      setIsConnected(false);
      setChipInfo('');
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.name.endsWith('.bin')) {
        setFirmwareFile(file);
        addLog(`Selected firmware: ${file.name} (${(file.size / 1024).toFixed(2)} KB)`);
        setShowAddFirmwareDialog(false);

        // Save to local storage
        file.arrayBuffer().then(arrayBuffer => {
          saveFirmwareToDB(file.name, arrayBuffer).then(() => {
            loadLocalFirmwares(); // Refresh the local firmwares list
            addLog(`✓ Saved ${file.name} to local storage`);
          }).catch((error: Error) => {
            addLog(`⚠ Could not save to storage: ${error.message}`);
          });
        });
      } else {
        addLog('❌ Please select a .bin file');
      }
    }
  };

  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  const flashFirmware = async () => {
    if (!espLoaderRef.current || !firmwareFile) {
      addLog('No device connected or no firmware file selected');
      return;
    }
    const addrStr = flashAddress.trim();
    const isValidAddr = /^0x[0-9a-fA-F]+$/.test(addrStr);
    if (!isValidAddr) {
      addLog('❌ Invalid flash address. Use hex like 0x10000');
      return;
    }
    const address = parseInt(addrStr, 16);
    try {
      setIsFlashing(true);
      setProgress(0);
      addLog('Starting flash process...');

      const esploader = espLoaderRef.current;
      const arrayBuffer = await firmwareFile.arrayBuffer();
      addLog(`File size: ${arrayBuffer.byteLength} bytes`);

      const fileArray = [{
        data: Array.from(new Uint8Array(arrayBuffer)).map(b => String.fromCharCode(b)).join(''),
        address: address
      }];

      addLog(`Writing firmware to address ${flashAddress}...`);
      setProgress(10);

      const esploaderAny = esploader as unknown as {
        writeFlash: (options: {
          fileArray: Array<{ data: string; address: number }>;
          flashSize: string;
          eraseAll: boolean;
          compress: boolean;
          flashMode: string;
          flashFreq: string;
          reportProgress: (fileIndex: number, written: number, total: number) => void;
        }) => Promise<void>;
      };

      await esploaderAny.writeFlash({
        fileArray,
        flashSize: 'keep',
        eraseAll: false,
        compress: true,
        flashMode: 'dio',
        flashFreq: '40m',
        reportProgress: (fileIndex: number, written: number, total: number) => {
          const fileProgress = (written / total) * 100;
          const totalProgress = 10 + (fileProgress * 0.9);
          setProgress(Math.round(totalProgress));
        }
      });

      setProgress(100);
      addLog('✅ Flash completed successfully!');
      addLog('🔄 Finalizing flash process...');

      try {
        if (serialPortRef.current && 'setSignals' in serialPortRef.current) {
          try {
            addLog('Sending reset signals...');
            const port = serialPortRef.current;
            await port.setSignals({ dataTerminalReady: false, requestToSend: true });
            await new Promise(resolve => setTimeout(resolve, 50));
            await port.setSignals({ dataTerminalReady: true, requestToSend: false });
            await new Promise(resolve => setTimeout(resolve, 50));
          } catch (signalError: unknown) {
            console.log('Signal error:', signalError);
          }
        }

        if (transportRef.current) {
          addLog('Closing transport...');
          await transportRef.current.disconnect();
          await new Promise(resolve => setTimeout(resolve, 100));
        }

        if (serialPortRef.current) {
          addLog('Closing serial port...');
          if (serialPortRef.current.readable) {
            await serialPortRef.current.close();
          }
        }
      } catch (cleanupError: unknown) {
        console.log('Cleanup error:', cleanupError);
        addLog('Cleanup completed with warnings');
      }

      transportRef.current = null;
      espLoaderRef.current = null;
      serialPortRef.current = null;
      setIsConnected(false);
      setChipInfo('');

      addLog('');
      addLog('🎊 FIRMWARE FLASH COMPLETE!');
      addLog('📋 If device is not responding then follow these Steps:');
      addLog('   1. ➡️  Press the RESET button on your ESP32-C6');
      addLog('   2. ⏳  Wait 2-3 seconds');
      addLog('   3. 🔵  Device will start with new firmware');
      addLog('');
      addLog('💡 Troubleshooting:');
      addLog("   • If device doesn't respond: Power cycle USB");
      addLog('   • To flash again: Click "Connect Device"');
      addLog('   • Check device in Bluetooth settings');

    } catch (error: unknown) {
      addLog(`❌ Flash error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      console.error(error);

      try {
        if (transportRef.current) {
          await transportRef.current.disconnect();
        }
        if (serialPortRef.current && serialPortRef.current.readable) {
          await serialPortRef.current.close();
        }
      } catch (cleanupError: unknown) {
        console.log('Cleanup error during flash failure:', cleanupError);
      }

      transportRef.current = null;
      espLoaderRef.current = null;
      serialPortRef.current = null;
      setIsConnected(false);
      setChipInfo('');
    } finally {
      setIsFlashing(false);
    }
  };

  const clearLogs = () => {
    setLogs([]);
  };

  const fetchGithubReleases = async () => {
    setIsFetchingGithub(true);
    try {
      addLog(`Fetching firmwares from GitHub: ${githubRepo}...`);
      const apiUrl = `https://api.github.com/repos/${githubRepo}/releases/latest`;

      let releasesData: GithubRelease | null = null;

      try {
        addLog('Trying GitHub API...');
        const response = await fetch(apiUrl, {
          headers: { 'Accept': 'application/vnd.github.v3+json' },
          signal: AbortSignal.timeout(10000)
        });

        if (response.ok) {
          releasesData = await response.json() as GithubRelease;
          addLog('✓ Successfully fetched from GitHub API');
        }
      } catch (error: unknown) {
        console.log('GitHub API fetch failed:', error);
      }

      if (!releasesData) {
        const corsProxies = [
          { name: 'allOrigins', url: `https://api.allorigins.win/raw?url=${encodeURIComponent(apiUrl)}` },
          { name: 'corsProxy', url: `https://corsproxy.io/?${encodeURIComponent(apiUrl)}` }
        ];

        for (const proxy of corsProxies) {
          try {
            addLog(`Trying ${proxy.name}...`);
            const response = await fetch(proxy.url, {
              headers: { 'Accept': 'application/vnd.github.v3+json' },
              signal: AbortSignal.timeout(10000)
            });

            if (response.ok) {
              releasesData = await response.json() as GithubRelease;
              addLog(`✓ Successfully fetched via ${proxy.name}`);
              break;
            }
          } catch (error: unknown) {
            console.log(`Proxy ${proxy.name} failed:`, error);
          }
        }
      }

      if (!releasesData) {
        throw new Error('Failed to fetch releases. Please check your internet connection or try again later.');
      }

      const assets = releasesData.assets || [];
      const firmwares = assets
        .filter((asset: GithubAsset) => asset.name.endsWith('.bin'))
        .map((asset: GithubAsset) => ({
          name: asset.name,
          url: asset.browser_download_url,
        }));

      if (firmwares.length === 0) {
        addLog('⚠ No .bin files found in the latest release');
        return;
      }

      setGithubFirmwares(firmwares);
      setShowGithubDialog(true);
      addLog(`✓ Found ${firmwares.length} firmware(s) in latest release`);

    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      addLog(`❌ Error: ${errorMsg}`);
      addLog('\n💡 You can still flash firmware by:');
      addLog('1. Downloading .bin files manually from GitHub');
      addLog(`2. Visit: https://github.com/${githubRepo}/releases`);
      addLog('3. Use "Add Firmware" button to upload them');
    } finally {
      setIsFetchingGithub(false);
    }
  };

  const downloadGithubFirmware = async (url: string, name: string) => {
    setDownloadingFirmware(name);
    setDownloadProgress('Initializing...');
    try {
      addLog(`Downloading ${name}...`);

      const commonHeaders = {
        'Accept': 'application/octet-stream, */*',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      };

      let arrayBuffer: ArrayBuffer | null = null;
      let successMethod = '';

      // Only use CORS Proxy
      try {
        setDownloadProgress('Downloading via CORS Proxy...');
        addLog(`Downloading via CORS Proxy...`);

        const response = await fetch(`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`, {
          method: 'GET',
          headers: commonHeaders,
          signal: AbortSignal.timeout(20000),
          mode: 'cors'
        });

        if (response.ok && response.status === 200) {
          const contentType = response.headers.get('content-type');
          if (contentType && contentType.includes('text/html')) {
            addLog(`⚠ CORS Proxy: Got HTML response, skipping`);
          } else {
            setDownloadProgress(`Downloading via CORS Proxy...`);
            arrayBuffer = await response.arrayBuffer();

            if (arrayBuffer.byteLength > 1000) {
              successMethod = 'CORS Proxy';
              addLog(`✓ Download successful via ${successMethod} (${(arrayBuffer.byteLength / 1024).toFixed(2)} KB)`);
            }
          }
        }
      } catch (error: unknown) {
        console.log('CORS proxy download failed:', error);
      }

      if (!arrayBuffer || arrayBuffer.byteLength < 1000) {
        addLog(`❌ Download failed for ${name}`);
        throw new Error(`Download failed. Please use manual download option.`);
      }

      setDownloadProgress('Saving to storage...');
      addLog(`Saving to browser storage...`);
      await saveFirmwareToDB(name, arrayBuffer);
      await loadLocalFirmwares();

      const file = new File([arrayBuffer], name, { type: 'application/octet-stream' });
      setFirmwareFile(file);
      setShowGithubDialog(false);
      addLog(`✓ Successfully downloaded and saved ${name}`);
      addLog(`✓ Ready to flash! Click "Flash Firmware" when device is connected.`);

    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      addLog(`❌ Download error: ${errorMsg}`);
      addLog(`\n🚀 Manual Download Instructions:`);
      addLog(`   1. Visit: https://github.com/${githubRepo}/releases/latest`);
      addLog(`   2. Find and click on "${name}"`);
      addLog(`   3. Save the .bin file to your computer`);
      addLog(`   4. Use "Add Firmware" button to upload it`);
    } finally {
      setDownloadingFirmware(null);
      setDownloadProgress('');
    }
  };

  const loadFirmwareFromStorage = async (name: string) => {
    try {
      addLog(`Loading ${name} from storage...`);
      const arrayBuffer = await getFirmwareFromDB(name);

      if (arrayBuffer) {
        const file = new File([arrayBuffer], name, { type: 'application/octet-stream' });
        setFirmwareFile(file);
        addLog(`✓ Loaded ${name} (${(arrayBuffer.byteLength / 1024).toFixed(2)} KB)`);
      } else {
        addLog(`❌ Firmware ${name} not found in storage`);
      }
    } catch (error: unknown) {
      addLog(`Error loading firmware: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const deleteFirmwareFromStorage = async (name: string) => {
    try {
      await deleteFirmwareFromDB(name);
      await loadLocalFirmwares();
      addLog(`Deleted ${name} from storage`);

      if (firmwareFile && firmwareFile.name === name) {
        setFirmwareFile(null);
      }
    } catch (error: unknown) {
      addLog(`Error deleting firmware: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const clearAllFirmwares = async () => {
    try {
      if (confirm('Are you sure you want to delete all stored firmwares? This cannot be undone.')) {
        addLog('Clearing all stored firmwares...');
        await resetDatabase();
        await loadLocalFirmwares();
        setFirmwareFile(null);
        addLog('✓ All firmwares cleared from storage');
      }
    } catch (error: unknown) {
      addLog(`Error clearing storage: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  return (
    <div className="h-screen bg-gradient-to-br from-gray-900 via-blue-900 to-gray-900 p-4 overflow-y-auto">
      <div className="h-full flex flex-col lg:flex-row gap-4 max-w-8xl mx-auto">
        {/* Main Content - Left Side */}
        <div className="flex-1 flex flex-col lg:flex-row min-h-0 gap-4 ">
          <div className="bg-gray-800 rounded-2xl shadow-2xl p-6 border border-gray-700 flex-1 flex flex-col flex-shrink-0">
            {/* Header */}
            <div className="mb-2">
              <h1 className="text-lg xl:text-3xl font-bold text-white ">Neuro PlayGround (NPG) Lite Firmware Flasher</h1>
            </div>

            {/* Connection Section */}
            <div className="flex items-center gap-4 mb-2">
              {!isConnected ? (
                <button
                  onClick={connectToDevice}
                  className="connection-section px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
                >
                  Connect Device
                </button>
              ) : (
                <button
                  onClick={disconnectDevice}
                  className="px-6 py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors"
                >
                  Disconnect
                </button>
              )}
              {chipInfo && (
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
                  <span className="text-green-400 font-medium">{chipInfo} Connected</span>
                </div>
              )}
            </div>

            {/* Firmware Section */}
            <div className="firmware-selection flex-1 flex flex-col">
              <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-4">
                <h2 className="text-lg font-semibold text-white">Firmware Binary</h2>
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowAddFirmwareDialog(true)}
                    className="add-firmware-btn flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm transition-colors"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Add Firmware
                  </button>
                  <button
                    onClick={fetchGithubReleases}
                    disabled={isFetchingGithub}
                    className="github-firmware-btn flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg text-sm transition-colors"
                  >
                    {isFetchingGithub ? (
                      <>
                        <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Loading...
                      </>
                    ) : (
                      <>
                        <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                        </svg>
                        Get from GitHub
                      </>
                    )}
                  </button>
                </div>
              </div>

              <div className="space-y-4">
                {/* Selected Firmware Display */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Selected Firmware
                  </label>
                  {firmwareFile ? (
                    <div className="p-3 bg-gray-900 rounded-lg border border-green-500">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-green-400 font-medium">{firmwareFile.name}</p>
                          <p className="text-gray-400 text-sm">{(firmwareFile.size / 1024).toFixed(2)} KB</p>
                        </div>
                        <button
                          onClick={() => setFirmwareFile(null)}
                          className="text-red-400 hover:text-red-300"
                        >
                          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="p-4 bg-gray-900 rounded-lg border border-gray-600 text-center">
                      <p className="text-gray-400">No firmware selected</p>
                      <p className="text-gray-500 text-sm mt-1">Use &quot;Add Firmware&quot; or &quot;Get from GitHub&quot; to select a firmware</p>
                    </div>
                  )}
                </div>

                {/* Advanced Options - Now as popup */}
                <div className="flash-address-section relative">
                  <button
                    ref={advancedButtonRef}
                    onClick={() => setShowAdvanced(!showAdvanced)}
                    className="flex items-center gap-2 text-sm font-medium text-gray-300 hover:text-white transition-colors"
                  >
                    <svg
                      className={`h-4 w-4 transition-transform ${showAdvanced ? 'rotate-90' : ''}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    Advanced Option
                  </button>

                  {showAdvanced && (
                    <div className="advanced-popup absolute bottom-full left-0 mb-2 z-10 w-80 p-4 bg-gray-800 rounded-lg border border-gray-600 shadow-xl">
                      <label className="block text-sm font-medium text-gray-300 mb-2">
                        Flash Address (hex)
                      </label>
                      <input
                        type="text"
                        value={flashAddress}
                        onChange={(e) => setFlashAddress(e.target.value)}
                        placeholder="0x10000"
                        className="w-full px-3 py-2 bg-gray-700 text-white rounded-lg border border-gray-600 focus:border-blue-500 focus:outline-none"
                        disabled={isFlashing}
                      />
                      <p className="mt-2 text-xs text-gray-400">
                        Default: 0x10000 (application partition)
                      </p>
                      <p className="mt-1 text-xs text-gray-500">
                        Change only if you know what you&apos;re doing
                      </p>
                    </div>
                  )}
                </div>

                {/* Flash Button */}
                <button
                  onClick={flashFirmware}
                  disabled={!isConnected || isFlashing || !firmwareFile}
                  className="flash-button w-full px-6 py-3 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors"
                >
                  {isFlashing ? 'Flashing...' : 'Flash Firmware'}
                </button>
              </div>
              {/* Progress Bar */}
              {isFlashing && (
                <div className="progress-section mt-4">
                  <div className="w-full bg-gray-600 rounded-full h-4 overflow-hidden">
                    <div
                      className="bg-green-500 h-full transition-all duration-300 flex items-center justify-center text-white text-xs font-semibold"
                      style={{ width: `${progress}%` }}
                    >
                      {progress > 5 && `${progress}%`}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
          {/* Console Section - Middle */}
          <div className="console-section w-full lg:w-70 xl:w-100 2xl:w-150 flex-shrink-0">
            <div className="bg-gray-800 rounded-2xl shadow-2xl p-6 border border-gray-700 h-full flex flex-col">
              {/* Console Logs */}
              <div className="flex-1 min-h-0 flex flex-col">
                <div className="flex justify-between items-center mb-3">
                  <h2 className="text-lg font-semibold text-white">Console</h2>
                  <button
                    onClick={clearLogs}
                    className="px-3 py-1 bg-gray-600 hover:bg-gray-500 text-white rounded text-sm transition-colors"
                  >
                    Clear
                  </button>
                </div>
                <div className="bg-black rounded-lg p-3 flex-1 overflow-y-auto font-mono text-sm min-h-0">
                  {logs.map((log, index) => (
                    <div
                      key={index}
                      ref={index === logs.length - 1 ? lastLogRef : null}
                      className="text-green-400 mb-1 leading-relaxed"
                    >
                      {log}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Firmware Sidebar - Right Side */}
          <div className="local-firmwares-section w-full lg:w-80 flex-shrink-0">
            <div className="bg-gray-800 rounded-2xl shadow-2xl p-6 border border-gray-700 h-full flex flex-col">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-semibold text-white">Local Firmwares</h2>
                <div className="flex gap-2">
                  <span className="px-2 py-1 bg-blue-600 text-white rounded text-xs">
                    {localFirmwares.length}
                  </span>
                  {localFirmwares.length > 0 && (
                    <button
                      onClick={clearAllFirmwares}
                      className="px-2 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-xs transition-colors"
                      title="Clear All"
                    >
                      🗑️
                    </button>
                  )}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto">
                {localFirmwares.length === 0 ? (
                  <div className="text-center py-8">
                    <svg className="h-12 w-12 text-gray-600 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <p className="text-gray-400 text-sm">No firmwares stored locally.</p>
                    <p className="text-gray-500 text-xs mt-1">Download from GitHub or add local files to store them here.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {localFirmwares.map((firmware, index) => (
                      <div
                        key={index}
                        className={`border rounded-lg p-3 transition-colors ${firmwareFile?.name === firmware.name
                          ? 'border-green-500 bg-green-900 bg-opacity-20'
                          : 'border-gray-600 hover:bg-gray-700'
                          }`}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1 min-w-0">
                            <p className="text-white font-medium text-sm truncate">{firmware.name}</p>
                            <div className="flex justify-between mt-1 text-xs text-gray-400">
                              <span>{(firmware.size / 1024).toFixed(1)} KB</span>
                              <span>{new Date(firmware.timestamp).toLocaleDateString()}</span>
                            </div>
                          </div>
                        </div>
                        <div className="flex gap-2 mt-2">
                          <button
                            onClick={() => loadFirmwareFromStorage(firmware.name)}
                            className="flex-1 px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs transition-colors"
                          >
                            Load
                          </button>
                          <button
                            onClick={() => deleteFirmwareFromStorage(firmware.name)}
                            className="flex-1 px-2 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-xs transition-colors"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Quick Info */}
              <div className="mt-4 pt-4 border-t border-gray-700">
                <div className="space-y-2 text-xs text-gray-300">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                    <span>Loaded firmware ready</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                    <span>Firmware in storage</span>
                  </div>
                  <p className="text-gray-400 text-xs mt-2">
                    Firmwares are stored in your browser and persist between sessions.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Hidden file input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileUpload}
        accept=".bin"
        className="hidden"
      />

      {/* Add Firmware Dialog */}
      {showAddFirmwareDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-lg shadow-xl max-w-md w-full border border-gray-700">
            <div className="border-b border-gray-700 p-4 flex justify-between items-center">
              <h2 className="text-xl font-semibold text-white">Add Firmware</h2>
              <button
                onClick={() => setShowAddFirmwareDialog(false)}
                className="text-gray-400 hover:text-white transition-colors"
              >
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-6">
              <div className="text-center">
                <svg className="h-16 w-16 text-gray-400 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
                </svg>
                <p className="text-gray-300 mb-4">Select a .bin firmware file from your computer</p>
                <button
                  onClick={triggerFileInput}
                  className="w-full px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
                >
                  Choose File
                </button>
                <p className="text-gray-500 text-sm mt-3">The firmware will be saved to your local storage</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* GitHub Firmware Dialog */}
      {showGithubDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full border border-gray-700 max-h-[80vh] flex flex-col">
            <div className="border-b border-gray-700 p-4 flex justify-between items-center flex-shrink-0">
              <div>
                <h2 className="text-xl font-semibold text-white">Available Firmwares ({githubFirmwares.length})</h2>
                <p className="text-sm text-gray-400 mt-1">Repository: {githubRepo}</p>
              </div>
              <button
                onClick={() => setShowGithubDialog(false)}
                className="text-gray-400 hover:text-white transition-colors"
              >
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1">
              {githubFirmwares.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-gray-400 mb-4">No firmware files found in the latest release.</p>
                  <button
                    onClick={fetchGithubReleases}
                    className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors"
                  >
                    Refresh
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {githubFirmwares.map((firmware, index) => {
                    const isDownloading = downloadingFirmware === firmware.name;
                    const isInStorage = localFirmwares.some(f => f.name === firmware.name);

                    return (
                      <div
                        key={index}
                        onClick={() => !isDownloading && downloadGithubFirmware(firmware.url, firmware.name)}
                        className={`border rounded-lg p-4 cursor-pointer transition-colors ${isDownloading
                          ? 'bg-blue-900 bg-opacity-30 border-blue-700'
                          : isInStorage
                            ? 'bg-green-900 bg-opacity-20 border-green-700 hover:bg-green-800'
                            : 'border-gray-600 hover:bg-gray-700'
                          }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3 flex-1">
                            {isDownloading ? (
                              <svg className="animate-spin h-5 w-5 text-blue-400" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                              </svg>
                            ) : isInStorage ? (
                              <svg className="h-5 w-5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                            ) : (
                              <svg className="h-5 w-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
                              </svg>
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="text-white font-medium truncate">{firmware.name}</p>
                              {isDownloading && (
                                <p className="text-sm text-blue-400 mt-1">{downloadProgress || 'Downloading...'}</p>
                              )}
                              {isInStorage && !isDownloading && (
                                <p className="text-sm text-green-400 mt-1">Already in storage</p>
                              )}
                            </div>
                          </div>
                          <svg className="h-5 w-5 text-gray-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      <AppTour autoStart={false} />
    </div>
  );
}