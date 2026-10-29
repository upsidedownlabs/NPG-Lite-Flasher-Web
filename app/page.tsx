'use client';

import { useState, useRef, useEffect } from 'react';
import { ESPLoader, Transport } from 'esptool-js';
import { AppTour } from './components/AppTour';
import { FileDown, Bluetooth, Wifi, Usb, Loader2, Plus, X, Check, ChevronRight, FileText, CloudDownload, Trash2, ChevronDown } from 'lucide-react';

// IndexedDB utility functions
const DB_NAME = 'ESP32FlasherDB';
const DB_VERSION = 2;
const STORE_NAME = 'firmwares';

// A GitHub repo whose releases are served by its own Cloudflare Worker proxy
// (GitHub release downloads have no CORS headers). Each Worker serves one repo
// at /latest and /firmware/<tag|latest>/<file>.
interface FirmwareSource {
  repo: string;
  worker: string;
}

// Built-in BLE/WiFi/Serial firmwares
const PREBUILT_SOURCE: FirmwareSource = {
  repo: 'upsidedownlabs/Chords-Arduino-Firmware',
  worker: 'https://chords-arduino-firmware.myupsidedownlab.workers.dev',
};

// NPG Lite project firmwares
const NPG_LITE_SOURCE: FirmwareSource = {
  repo: 'upsidedownlabs/NPG-Lite-Arduino-Firmware',
  worker: 'https://npg-flasher-web.myupsidedownlab.workers.dev',
};

// Worker URL that serves one release asset (tag may be "latest")
const workerFirmwareUrl = (source: FirmwareSource, tag: string, file: string) =>
  `${source.worker}/firmware/${encodeURIComponent(tag)}/${encodeURIComponent(file)}`;

interface LatestRelease {
  tag: string;
  /** null when the tag is known but the asset list couldn't be fetched */
  assets: { name: string; url: string }[] | null;
}

// Pre-built firmwares are pulled from the latest release of this repo.
const PREBUILT_FIRMWARE_REPO = PREBUILT_SOURCE.repo;

// Default firmware files
interface DefaultFirmware {
  /** Release asset name - also the name it's stored under locally */
  name: string;
  description: string;
  type: 'ble' | 'wifi' | 'serial';
}

// Every release asset listed here is a full-flash merged image (bootloader +
// partition table + otadata + app).
const DEFAULT_FIRMWARES: DefaultFirmware[] = [
  {
    name: 'Chords-NPG-LITE-BLE-ESP32C6.merged.bin',
    description: 'Streams bio-signals to Chords over Bluetooth Low Energy.',
    type: 'ble'
  },
  {
    name: 'Chords-NPG-LITE-WiFi-ESP32C6.merged.bin',
    description: 'Streams bio-signals to Chords over WiFi.',
    type: 'wifi'
  },
  {
    name: 'Chords-NPG-LITE-Serial-ESP32C6.merged.bin',
    description: 'Streams bio-signals to Chords over a USB serial connection.',
    type: 'serial'
  }
  // No default bootloader.bin / partition-table.bin here on purpose: projects
  // now ship a single merged image (bootloader + partitions + app combined),
  // so there's nothing to pre-bundle for full-flash mode anymore. Bootloader/
  // partition files for the "Flash complete firmware" recovery path are added
  // manually via "Add Firmware" only when actually needed.
];

// Names the defaults were previously stored under (bundled copies, then the
// pre-".merged" release asset names). Removed from storage on startup so they
// don't linger as "custom" firmwares.
const LEGACY_DEFAULT_FIRMWARE_NAMES = [
  'npg-lite-ble.ino.merged.bin',
  'npg-lite-wifi.ino.merged.bin',
  'npg-lite-serial.ino.merged.bin',
  'Chords-NPG-LITE-BLE-ESP32C6.bin',
  'Chords-NPG-LITE-WiFi-ESP32C6.bin',
  'Chords-NPG-LITE-ESP32C6.bin',
];

// What each NPG Lite project does, from the NPG-Lite-Arduino-Firmware READMEs.
// Keyed by project name (the release asset name without ".ino.merged.bin").
// TODO: read these from a YAML file in each firmware repo once it exists.
const PROJECT_DESCRIPTIONS: Record<string, string> = {
  '1CH-HCI-BCI-Serial': 'Detects focus (EEG), double and triple blinks (EOG) and jaw clenches (EMG) from one channel.',
  'BCI-BLE-Gamepad': 'A BLE gamepad that plays games with your focus and muscle contractions (EEG and EMG).',
  'BCI-Blink-BLE': 'Controls a menu of options with double blinks and focus, built for ALS patients.',
  'BCI-Blink-Serial': 'Example of double-blink and focus detection, printed over serial.',
  'BCI-IR-Remote': 'Records any IR remote and fires its buttons hands-free with brain, eye and muscle signals.',
  'BCI-IR-Send': 'Toggles an LG AC on and off with EEG beta-band power (focus).',
  'BCI-Relay-Server': 'Switches a relay over BLE with focus and double blinks; hold BOOT to switch to manual mode.',
  'BLE-BCI-Car': 'BLE client that receives commands and drives the car through its GPIO pins.',
  'BLE-BCI-Car-Remote': 'Drives a robotic car hands-free over BLE with EEG (focus) and EMG (muscle) signals.',
  'BLE-BCI-Protobot-Remote': 'Drives a stock microbots.io ProtoBot over BLE with brain and muscle signals.',
  'BLE-BCI-Server-Toggle': 'BLE server that notifies a client when EEG beta-band power crosses a threshold.',
  'BLE-Client': 'BLE client that receives notifications from a server and triggers a GPIO pin.',
  'BLE-Server': 'BLE server that streams real-time NPG Lite data to a connected client.',
  'Blinky-Keys-BLE': 'BLE keyboard for slides: double blink for next (right arrow), triple blink for previous.',
  'Blinky-Keys-Serial': 'Detects double and triple blinks from EOG signals and prints them over serial.',
  'EMG-AirMouse': 'Moves the mouse with your hand and clicks with forearm muscle (EMG) signals.',
  'Gyro-Motion-Detection': 'Streams MPU6050 accelerometer data and sends 4 keystrokes to play games on a laptop.',
  'IR-LG-Receive': 'Reads and identifies the buttons of an LG AC remote over infrared.',
  'IR-LG-Send': 'Toggles an LG AC on and off over infrared with the user button.',
  'NPG-Default': 'The default program: visual, sound and haptic feedback on the NPG Lite.',
  'NPG-Gaming-Wheel': 'An Xbox-style racing controller: steer with a wheel and press pedals with leg muscles (EMG).',
  'NPG-Joystick-BMI270': 'Hands-free joystick-style mouse from head movement (BMI270) plus blinks and jaw clenches.',
  'NPG-Joystick-MPU6050': 'Hands-free joystick-style mouse from head movement (MPU6050) plus blinks.',
  'NPG-Mouse-BMI270': 'Hands-free mouse from head movement (BMI270) plus blinks and jaw clenches.',
  'NPG-Mouse-MPU6050': 'Hands-free mouse from head movement (MPU6050) plus blinks.',
  'NPG-TELLO-Drone': 'Flies a DJI Tello drone hands-free with brain and muscle signals, blinks and jaw clenches.',
  'NPG-UFO-Drone': 'Flies a UFO drone hands-free with brain and muscle signals, blinks and jaw clenches.',
  'Protobot_armband': 'A 3-channel EMG armband that drives a stock microbots.io ProtoBot with hand gestures.',
  'Serial-FFT': 'Calculates the FFT and band power of one EEG channel and prints them over serial.',
  'Wheelchair-Sim': 'Controls a computer or game with left/right eye movements and jaw clenches.',
};

// What a firmware file does, or null when we don't know it yet
const describeFirmware = (fileName: string): string | null => {
  const builtIn = DEFAULT_FIRMWARES.find(f => f.name.toLowerCase() === fileName.toLowerCase());
  if (builtIn) return builtIn.description;
  const project = fileName.replace(/(\.ino)?(\.merged)?\.bin$/i, '');
  return PROJECT_DESCRIPTIONS[project] ?? null;
};

// Merged images already contain bootloader + partition table, so they're
// always flashed whole at 0x0 and never need "Flash complete firmware".
const isMergedImageName = (name: string): boolean =>
  /merged/i.test(name) ||
  DEFAULT_FIRMWARES.some(f => f.name.toLowerCase() === name.toLowerCase());

// Filenames of firmwares shipped with the app itself - these can never be
// deleted by the user, regardless of their "type" tag. Matching by name
// (not type) means per-project bootloader/partition files that happen to
// share a type with the two genuine defaults are still deletable normally.

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
        store.createIndex('type', 'type', { unique: false });
      }
    };
  });
};

const saveFirmwareToDB = async (name: string, data: ArrayBuffer, type?: string, version?: string): Promise<void> => {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      const firmware = {
        name,
        data,
        timestamp: Date.now(),
        size: data.byteLength,
        ...(type && { type }),
        ...(version && { version })
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
          size: data.byteLength,
          ...(type && { type }),
          ...(version && { version })
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
  type?: string;
  /** Release tag a default firmware was downloaded from */
  version?: string;
  isDefault?: boolean;
}

const getAllFirmwaresFromDB = async (): Promise<FirmwareInfo[]> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);

    const request = store.getAll();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const items = request.result as Array<{
        name: string;
        size: number;
        timestamp: number;
        type?: string;
        version?: string;
        data: ArrayBuffer;
      }>;

      const firmwares: FirmwareInfo[] = items.map(item => ({
        name: item.name,
        size: item.size,
        timestamp: item.timestamp,
        type: item.type,
        version: item.version,
        // Match by exact filename against the app-shipped defaults, not by
        // type. Matching by type alone incorrectly protects every bootloader/
        // partition-table file with that type - including per-project ones
        // saved under the same generic type - leaving them permanently
        // undeletable with no error or explanation.
        isDefault: DEFAULT_FIRMWARES.some(d => d.name === item.name) ? true : undefined
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
  /** Project name, e.g. "Protobot_armband" (".ino.merged.bin" suffix stripped) */
  name: string;
  /** Download URL for the project's merged.bin */
  url: string;
}

interface GithubAsset {
  name: string;
}

interface GithubRelease {
  tag_name: string;
  assets: GithubAsset[];
}

// Converts a raw GitHub API release into the Worker's format, with downloads
// still going through the Worker (GitHub downloads have no CORS headers).
const fromGithubRelease = (source: FirmwareSource, release: GithubRelease): LatestRelease => ({
  tag: release.tag_name,
  assets: (release.assets || []).map(a => ({ name: a.name, url: workerFirmwareUrl(source, release.tag_name, a.name) })),
});

// Latest release of a repo, via the Worker (token-authenticated and cached,
// so visitors don't hit GitHub's 60 req/hour unauthenticated limit). Falls
// back to calling the GitHub API directly. null if both fail.
const fetchLatestRelease = async (source: FirmwareSource): Promise<LatestRelease | null> => {
  try {
    const response = await fetch(`${source.worker}/latest`, {
      signal: AbortSignal.timeout(10000),
      mode: 'cors'
    });
    if (response.ok) return await response.json() as LatestRelease;
  } catch (error) {
    console.log('Worker release lookup failed:', error);
  }
  try {
    const response = await fetch(`https://api.github.com/repos/${source.repo}/releases/latest`, {
      headers: { 'Accept': 'application/vnd.github.v3+json' },
      signal: AbortSignal.timeout(10000)
    });
    if (response.ok) return fromGithubRelease(source, await response.json() as GithubRelease);
  } catch (error) {
    console.log('GitHub API release lookup failed:', error);
  }
  return null;
};

// Console line colour from the message's leading marker
const logLineClass = (log: string): string => {
  const msg = log.replace(/^\[[^\]]*\]\s*/, '');
  if (/^(Error|Flash error|Download error)\b/.test(msg)) return 'text-red-400';
  if (/^Warning:/.test(msg)) return 'text-amber-300';
  if (/^✓/.test(msg)) return 'text-emerald-400';
  return 'text-neutral-300';
};

// Fixed offsets used when flashing the complete firmware set
const BOOTLOADER_ADDRESS = 0x0;
const PARTITION_TABLE_ADDRESS = 0x8000;
const OTADATA_ADDRESS = 0xe000;
const APP_ADDRESS = 0x10000;

// The Arduino IDE's own upload flow (and esp32-arduino's esptool wrapper)
// always writes a small "boot_app0.bin" to the otadata partition (0xe000)
// alongside bootloader/partitions/app. It tells the 2nd-stage bootloader
// which OTA slot to boot (ota_0). Skipping this write is harmless on a
// completely blank chip (blank otadata defaults to ota_0), but if the chip
// previously ran *any* other firmware, stale/garbage bytes can be left in
// that region - the bootloader then fails to resolve a valid OTA slot and
// the board resets in a loop. This binary is identical for every project
// built with the standard "default" ESP32 partition scheme (8KB, fixed
// content), so it's embedded here rather than needing to ship it per-project.
const BOOT_APP0_BASE64 = 'AQAAAP///////////////////////////////5qYQ0f//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////wAAAAD///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////8=';


// Common suffixes emitted by arduino-cli --export-binaries. Used to pick a
// sensible default flash address for a firmware file the moment it's
// selected as "the App Firmware", and to explain that choice to the user.
type AddressKind = 'merged' | 'bootloader' | 'partition' | 'app';

interface DetectedAddress {
  kind: AddressKind;
  address: string;
  /** Plain-language explanation shown to the user for why this address was picked */
  reason: string;
}

const detectAddressForFilename = (name: string): DetectedAddress => {
  const lower = name.toLowerCase();

  if (isMergedImageName(name)) {
    return {
      kind: 'merged',
      address: '0x0',
      reason: 'This is a merged image - bootloader, partition table, OTA data, and app are already combined into one file at their correct offsets. It must be written starting at 0x0 so every part lands in the right place.',
    };
  }

  if (lower.includes('bootloader')) {
    return {
      kind: 'bootloader',
      address: '0x0',
      reason: 'This is a bootloader binary. On ESP32 boards it always belongs at 0x0, the very start of flash.',
    };
  }

  if (lower.includes('partition')) {
    return {
      kind: 'partition',
      address: '0x8000',
      reason: 'This is a partition table binary. It always belongs at 0x8000.',
    };
  }

  return {
    kind: 'app',
    address: '0x10000',
    reason: 'This looks like an app-only binary (not a merged image). It belongs at 0x10000, the start of the app partition - writing it anywhere else would overwrite the bootloader/partition table region or miss the app slot entirely.',
  };
};

// One-line summary of where each kind of file is written (Advanced Options popup)
const ADDRESS_HINTS: Record<AddressKind, string> = {
  merged: 'Merged image, written from the start of flash.',
  bootloader: 'Bootloader, always at the start of flash.',
  partition: 'Partition table, always at 0x8000.',
  app: 'App-only file, written to the app partition.',
};

const GithubMark = ({ className }: { className?: string }) => (
  <svg className={className} fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
  </svg>
);

// Where the flasher's own source code lives
const FLASHER_REPO_URL = 'https://github.com/upsidedownlabs/NPG-Lite-Flasher-Web';

export default function ESP32Flasher() {
  const [isConnected, setIsConnected] = useState(false);
  const [isFlashing, setIsFlashing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [firmwareFile, setFirmwareFile] = useState<File | null>(null);
  const [chipInfo, setChipInfo] = useState<string>('');
  const [flashAddress, setFlashAddress] = useState<string>('0x10000');
  const [addressAutoReason, setAddressAutoReason] = useState<string>('');
  const [flashFullFirmware, setFlashFullFirmware] = useState(false);
  // Explicit, mandatory selections for full-flash mode. All three must be
  // set by the user (or picked from Local Firmwares) before flashing is
  // allowed - nothing is auto-guessed by filename.
  const [bootloaderFile, setBootloaderFile] = useState<File | null>(null);
  const [partitionTableFile, setPartitionTableFile] = useState<File | null>(null);
  const [showAddFirmwareDialog, setShowAddFirmwareDialog] = useState(false);
  const [showFullFlashDialog, setShowFullFlashDialog] = useState(false);
  // Which drop zone a dragged file is over (Your Firmwares list or the Add Firmware dialog)
  const [dropTarget, setDropTarget] = useState<'list' | 'dialog' | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  // Popup is fixed to the window (so the scrolling Flash panel can't clip it),
  // placed just above the "Advanced Option" button
  const [advancedPopupPos, setAdvancedPopupPos] = useState<{ left: number; bottom: number } | null>(null);
  const [githubFirmwares, setGithubFirmwares] = useState<GithubFirmware[]>([]);
  const [isFetchingGithub, setIsFetchingGithub] = useState(false);
  const [downloadingFirmware, setDownloadingFirmware] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<string>('');
  // Progress of "Download All" for the NPG Lite projects (null when idle)
  const [downloadAllProgress, setDownloadAllProgress] = useState<{ done: number; total: number } | null>(null);
  const [localFirmwares, setLocalFirmwares] = useState<FirmwareInfo[]>([]);
  const [selectedDefaultFirmware, setSelectedDefaultFirmware] = useState<string>('');
  const [isLoadingDefaults, setIsLoadingDefaults] = useState(false);
  const [prebuiltVersion, setPrebuiltVersion] = useState<string>('');
  const latestPrebuiltTagRef = useRef<Promise<string | null> | null>(null);
  const ensureDefaultsPromiseRef = useRef<Promise<void> | null>(null);

  const transportRef = useRef<Transport | null>(null);
  const espLoaderRef = useRef<ExtendedESPLoader | null>(null);
  const serialPortRef = useRef<SerialPort | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // File picker used by "Add Files" in the Flash Complete Firmware dialog
  const fullFlashFileInputRef = useRef<HTMLInputElement>(null);
  const githubRepo = NPG_LITE_SOURCE.repo;
  const lastLogRef = useRef<HTMLDivElement>(null);
  const advancedButtonRef = useRef<HTMLButtonElement>(null);
  const githubListRequestedRef = useRef(false);

  const addLog = (message: string) => {
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${message}`]);
  };

  useEffect(() => {
    // Scroll only the console box - scrollIntoView would also scroll the
    // page itself in the stacked (small window) layout.
    const box = lastLogRef.current?.parentElement;
    if (box) {
      box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' });
    }
  }, [logs]);

  // Whenever the "App Firmware" file changes, look at its filename and
  // auto-pick the address it needs - merged images always go at 0x0,
  // plain app binaries at 0x10000, bootloader/partition files at their own
  // fixed offsets. This runs regardless of source (pre-built button, GitHub
  // download, Local Firmwares "Load", or manual "Add Firmware" upload) so
  // the behavior is consistent everywhere a firmware gets selected.
  useEffect(() => {
    if (!firmwareFile) {
      setAddressAutoReason('');
      return;
    }
    const detected = detectAddressForFilename(firmwareFile.name);
    setAddressAutoReason(detected.reason);
    // Full-flash mode ignores flashAddress entirely, so only touch it in
    // single-file mode - otherwise leave it alone so switching modes back
    // and forth doesn't fight the user's own edits.
    if (!flashFullFirmware) {
      setFlashAddress(detected.address);
    }
    // A merged image supersedes the whole 3-file full-flash approach, so
    // turn that mode off automatically if it was left on from before.
    if (detected.kind === 'merged' && flashFullFirmware) {
      setFlashFullFirmware(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firmwareFile]);

  // If the user manually edits the flash address away from what this file's
  // name implies, confirm with them first - a wrong address here can brick
  // the device (overwrite the bootloader, land outside the app partition,
  // etc.), so this isn't a silent "just trust the user typed it" field.
  const handleFlashAddressBlur = () => {
    if (!firmwareFile || flashFullFirmware) return;

    const detected = detectAddressForFilename(firmwareFile.name);
    const typed = flashAddress.trim().toLowerCase();
    const recommended = detected.address.toLowerCase();

    if (typed === recommended) return;

    const confirmed = window.confirm(
      `"${firmwareFile.name}" is normally flashed at ${detected.address}.\n\n` +
      `${detected.reason}\n\n` +
      `You've set it to ${flashAddress} instead. Writing to the wrong address can corrupt the flash layout ` +
      `or leave the board unable to boot. Keep ${flashAddress} anyway?`
    );

    if (!confirmed) {
      setFlashAddress(detected.address);
      addLog(`Address reverted to recommended ${detected.address} for ${firmwareFile.name}`);
    } else {
      addLog(`Warning: Using custom address ${flashAddress} for ${firmwareFile.name} (recommended: ${detected.address})`);
    }
  };

  const loadLocalFirmwares = async () => {
    try {
      const firmwares = await getAllFirmwaresFromDB();
      setLocalFirmwares(firmwares);
    } catch (error) {
      console.error('Error loading local firmwares:', error);
    }
  };

  // Resolves the latest release tag of the pre-built firmware repo, once per
  // session. null means GitHub couldn't be reached.
  const getLatestPrebuiltTag = (): Promise<string | null> => {
    if (!latestPrebuiltTagRef.current) {
      latestPrebuiltTagRef.current = (async () => {
        const release = await fetchLatestRelease(PREBUILT_SOURCE);
        if (release?.tag) setPrebuiltVersion(release.tag);
        return release?.tag ?? null;
      })();
    }
    return latestPrebuiltTagRef.current;
  };

  // Downloads a pre-built firmware from the GitHub release (through the
  // Cloudflare Worker, since release downloads aren't CORS-enabled).
  const fetchDefaultFirmwareData = async (
    firmware: DefaultFirmware,
    tag: string | null
  ): Promise<{ data: ArrayBuffer; version: string } | null> => {
    try {
      addLog(`Downloading ${firmware.name} from ${PREBUILT_FIRMWARE_REPO} ${tag ?? '(latest)'}...`);
      const response = await fetch(workerFirmwareUrl(PREBUILT_SOURCE, tag ?? 'latest', firmware.name), {
        signal: AbortSignal.timeout(60000),
        mode: 'cors'
      });
      const contentType = response.headers.get('content-type') || '';
      if (response.ok && !contentType.includes('text/html')) {
        const data = await response.arrayBuffer();
        if (data.byteLength > 1000) {
          return { data, version: tag ?? response.headers.get('X-Firmware-Version') ?? 'latest' };
        }
      }
      addLog(`Warning: GitHub download of ${firmware.name} failed (status ${response.status})`);
    } catch (error) {
      console.error(`Error downloading ${firmware.name} from GitHub:`, error);
      addLog(`Warning: GitHub download of ${firmware.name} failed`);
    }
    return null;
  };

  const ensureDefaultFirmwares = () => {
    // Runs once when the page opens (adding or downloading other firmwares
    // never re-checks the defaults); share one run if it's called again
    // while still in progress.
    if (!ensureDefaultsPromiseRef.current) {
      ensureDefaultsPromiseRef.current = runEnsureDefaultFirmwares().finally(() => {
        ensureDefaultsPromiseRef.current = null;
      });
    }
    return ensureDefaultsPromiseRef.current;
  };

  const runEnsureDefaultFirmwares = async () => {
    setIsLoadingDefaults(true);
    try {
      let existingFirmwares = await getAllFirmwaresFromDB();

      const legacy = existingFirmwares.filter(f => LEGACY_DEFAULT_FIRMWARE_NAMES.includes(f.name));
      for (const f of legacy) {
        await deleteFirmwareFromDB(f.name);
      }
      if (legacy.length > 0) {
        existingFirmwares = await getAllFirmwaresFromDB();
      }

      const latestTag = await getLatestPrebuiltTag();

      let loadedCount = 0;
      for (const firmware of DEFAULT_FIRMWARES) {
        const existing = existingFirmwares.find(f => f.name === firmware.name);
        // Offline (no tag): keep whatever is stored. Online: refresh anything
        // not downloaded from the latest release.
        const isStale = !!existing && !!latestTag && existing.version !== latestTag;
        if (existing && !isStale) continue;

        addLog(isStale
          ? `New pre-built release ${latestTag} available - updating ${firmware.type.toUpperCase()} firmware...`
          : `Loading default ${firmware.type.toUpperCase()} firmware...`);
        const result = await fetchDefaultFirmwareData(firmware, latestTag);
        if (!result) {
          addLog(`Warning: Could not load default ${firmware.type.toUpperCase()} firmware`);
          continue;
        }
        await saveFirmwareToDB(firmware.name, result.data, firmware.type, result.version);
        addLog(`✓ Saved ${firmware.name} (${result.version}, ${(result.data.byteLength / 1024).toFixed(2)} KB)`);
        loadedCount++;
      }

      setLocalFirmwares(await getAllFirmwaresFromDB());

      if (loadedCount > 0) {
        addLog(`✓ Loaded ${loadedCount} default firmware(s)`);
      }
    } finally {
      setIsLoadingDefaults(false);
    }
  };

  const loadDefaultFirmware = async (type: 'ble' | 'wifi' | 'serial') => {
    // Block if flashing is in progress
    if (isFlashing) return;

    const firmwareInfo = DEFAULT_FIRMWARES.find(f => f.type === type);
    if (!firmwareInfo) return;

    setSelectedDefaultFirmware(type);

    try {
      addLog(`Selecting ${firmwareInfo.type.toUpperCase()} firmware...`);

      // Check if already in storage
      const existing = localFirmwares.find(f => f.name === firmwareInfo.name);
      if (existing) {
        const arrayBuffer = await getFirmwareFromDB(firmwareInfo.name);
        if (arrayBuffer) {
          const file = new File([arrayBuffer], firmwareInfo.name, { type: 'application/octet-stream' });
          setFirmwareFile(file);
          addLog(`✓ Selected ${firmwareInfo.type.toUpperCase()} firmware (${(arrayBuffer.byteLength / 1024).toFixed(2)} KB)`);
        }
      } else {
        // Download and save
        const result = await fetchDefaultFirmwareData(firmwareInfo, await getLatestPrebuiltTag());
        if (result) {
          const arrayBuffer = result.data;
          const file = new File([arrayBuffer], firmwareInfo.name, { type: 'application/octet-stream' });
          setFirmwareFile(file);
          await saveFirmwareToDB(firmwareInfo.name, arrayBuffer, firmwareInfo.type, result.version);
          await loadLocalFirmwares();
          addLog(`✓ Downloaded and selected ${firmwareInfo.type.toUpperCase()} firmware (${(arrayBuffer.byteLength / 1024).toFixed(2)} KB)`);
        } else {
          addLog(`Error: Could not load ${firmwareInfo.type.toUpperCase()} firmware`);
        }
      }
    } catch (error) {
      addLog(`Error loading ${firmwareInfo.type.toUpperCase()} firmware: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  useEffect(() => {
    // Show what's stored right away, then make sure the defaults are present
    // and up to date - once per page load, independent of everything else
    loadLocalFirmwares().then(() => ensureDefaultFirmwares());
  }, []);

  // Files dropped outside a drop zone would otherwise be opened by the browser
  useEffect(() => {
    const block = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    };
    const clear = () => setDropTarget(null);
    window.addEventListener('dragover', block);
    window.addEventListener('drop', block);
    window.addEventListener('dragend', clear);
    window.addEventListener('drop', clear);
    return () => {
      window.removeEventListener('dragover', block);
      window.removeEventListener('drop', block);
      window.removeEventListener('dragend', clear);
      window.removeEventListener('drop', clear);
    };
  }, []);

  // Escape closes the "Flash complete firmware" dialog
  useEffect(() => {
    if (!showFullFlashDialog) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowFullFlashDialog(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showFullFlashDialog]);

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

    // A fixed popup would drift from its button when the page or the panel
    // holding it scrolls (or the window resizes) - close it instead. Other
    // scrolling, like the console following new logs, is ignored.
    const close = (event: Event) => {
      const t = event.target;
      const movesButton =
        event.type === 'resize' ||
        t === document ||
        (t instanceof Node && !!advancedButtonRef.current && t.contains(advancedButtonRef.current));
      if (movesButton) setShowAdvanced(false);
    };

    document.addEventListener('mousedown', handleClickOutside);
    if (showAdvanced) {
      window.addEventListener('resize', close);
      window.addEventListener('scroll', close, true);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [showAdvanced]);

  // The NPG Lite project list is shown inline, so fetch it on load (once,
  // even under React StrictMode's double-mount in development).
  useEffect(() => {
    if (githubListRequestedRef.current) return;
    githubListRequestedRef.current = true;
    fetchGithubReleases();
  }, []);



  const connectToDevice = async () => {
    try {
      // Check for Web Serial API support
      const navigatorWithSerial = navigator as Navigator & { serial?: Serial };
      if (!navigatorWithSerial.serial || typeof navigatorWithSerial.serial.requestPort !== 'function') {
        addLog('Error: Web Serial isn\'t supported in this browser. Use Chrome, Edge, Opera or Firefox 151+ on desktop, over HTTPS.');
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

  // Saves .bin files to local storage and selects the last one - shared by
  // the file picker and drag & drop
  const addFirmwareFiles = (files: File[], { keepSelection = false } = {}) => {
    // Block file upload if flashing is in progress
    if (isFlashing || files.length === 0) return;

    const bins = files.filter(f => f.name.toLowerCase().endsWith('.bin'));
    for (const f of files) {
      if (!bins.includes(f)) addLog(`Error: ${f.name} is not a .bin file`);
    }
    if (bins.length === 0) return;

    // Select the app when several files come in together - bootloader and
    // partition files are picked in "Flash complete firmware" instead
    const apps = bins.filter(f => !/bootloader|partition/i.test(f.name));
    const file = (apps.length > 0 ? apps : bins)[(apps.length > 0 ? apps : bins).length - 1];
    if (!keepSelection) {
      setFirmwareFile(file);
      addLog(`Selected firmware: ${file.name} (${(file.size / 1024).toFixed(2)} KB)`);
      setShowAddFirmwareDialog(false);
      setSelectedDefaultFirmware('');
    }
    // Flash address is set automatically based on the filename by the
    // effect watching firmwareFile (merged → 0x0, app → 0x10000, etc.)

    // Save to local storage
    for (const f of bins) {
      f.arrayBuffer().then(arrayBuffer => {
        saveFirmwareToDB(f.name, arrayBuffer).then(() => {
          loadLocalFirmwares(); // Refresh the local firmwares list
          addLog(`✓ Saved ${f.name} to local storage`);
        }).catch((error: Error) => {
          addLog(`Warning: Could not save to storage: ${error.message}`);
        });
      });
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    addFirmwareFiles(Array.from(e.target.files ?? []));
    // Let the same file be picked again later
    e.target.value = '';
  };

  // Drag & drop handlers for a drop zone
  const dropZone = (target: 'list' | 'dialog') => ({
    onDragEnter: (e: React.DragEvent) => {
      if (isFlashing || !e.dataTransfer.types.includes('Files')) return;
      e.preventDefault();
      setDropTarget(target);
    },
    onDragOver: (e: React.DragEvent) => {
      if (isFlashing || !e.dataTransfer.types.includes('Files')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      if (dropTarget !== target) setDropTarget(target);
    },
    onDragLeave: (e: React.DragEvent) => {
      // Ignore moves between child elements of the same zone
      if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
      setDropTarget(null);
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setDropTarget(null);
      addFirmwareFiles(Array.from(e.dataTransfer.files));
    },
  });

  // "Add Files" in the Flash Complete Firmware dialog: save the files and
  // fill whichever slots (bootloader, partition table, app) are still empty
  const handleFullFlashFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    addFirmwareFiles(files, { keepSelection: true });
    const bootloader = files.find(f => /bootloader/i.test(f.name) && f.name.toLowerCase().endsWith('.bin'));
    const partition = files.find(f => /partition/i.test(f.name) && f.name.toLowerCase().endsWith('.bin'));
    if (bootloader && !bootloaderFile) {
      setBootloaderFile(bootloader);
      addLog(`✓ Bootloader set to ${bootloader.name} (${(bootloader.size / 1024).toFixed(2)} KB)`);
    }
    if (partition && !partitionTableFile) {
      setPartitionTableFile(partition);
      addLog(`✓ Partition table set to ${partition.name} (${(partition.size / 1024).toFixed(2)} KB)`);
    }
    const app = files.find(f => f.name.toLowerCase().endsWith('.bin') && !/bootloader|partition/i.test(f.name) && !isMergedImageName(f.name));
    if (app && !firmwareFile) {
      setFirmwareFile(app);
      setSelectedDefaultFirmware('');
      addLog(`Selected firmware: ${app.name} (${(app.size / 1024).toFixed(2)} KB)`);
    }
  };

  const triggerFileInput = () => {
    if (isFlashing) return;
    fileInputRef.current?.click();
  };

  // ── Selection for the mandatory bootloader / partition-table slots ──
  // These are chosen from Local Firmwares (populated only via "Add Firmware"
  // or the default auto-downloads) - never a separate upload path.
  const loadBootloaderFromStorage = async (name: string) => {
    if (isFlashing) return;
    if (!name) {
      setBootloaderFile(null);
      return;
    }
    try {
      const arrayBuffer = await getFirmwareFromDB(name);
      if (arrayBuffer) {
        setBootloaderFile(new File([arrayBuffer], name, { type: 'application/octet-stream' }));
        addLog(`✓ Bootloader set to ${name} (${(arrayBuffer.byteLength / 1024).toFixed(2)} KB)`);
      } else {
        addLog(`Error: Could not load ${name} from storage`);
      }
    } catch (error: unknown) {
      addLog(`Error loading bootloader: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const loadPartitionTableFromStorage = async (name: string) => {
    if (isFlashing) return;
    if (!name) {
      setPartitionTableFile(null);
      return;
    }
    try {
      const arrayBuffer = await getFirmwareFromDB(name);
      if (arrayBuffer) {
        setPartitionTableFile(new File([arrayBuffer], name, { type: 'application/octet-stream' }));
        addLog(`✓ Partition table set to ${name} (${(arrayBuffer.byteLength / 1024).toFixed(2)} KB)`);
      } else {
        addLog(`Error: Could not load ${name} from storage`);
      }
    } catch (error: unknown) {
      addLog(`Error loading partition table: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  // Converts an ArrayBuffer into the binary-string format esptool-js expects
  const arrayBufferToBinaryString = (buffer: ArrayBuffer): string =>
    Array.from(new Uint8Array(buffer)).map(b => String.fromCharCode(b)).join('');

  // Decodes the embedded base64 boot_app0 blob straight into the binary-string
  // format esptool-js expects, without going through an intermediate File.
  const base64ToBinaryString = (b64: string): string => atob(b64);

  const flashFirmware = async () => {
    if (!espLoaderRef.current) {
      addLog('No device connected');
      return;
    }

    // In full-flash mode, all three files are mandatory and must be
    // explicitly selected by the user - no auto-lookup, no guessing by name.
    if (flashFullFirmware) {
      if (!bootloaderFile || !partitionTableFile || !firmwareFile) {
        addLog('Error: Full flash requires all three files to be selected:');
        addLog(`   Bootloader: ${bootloaderFile ? '✓ ' + bootloaderFile.name : '✗ not selected'}`);
        addLog(`   Partition table: ${partitionTableFile ? '✓ ' + partitionTableFile.name : '✗ not selected'}`);
        addLog(`   App: ${firmwareFile ? '✓ ' + firmwareFile.name : '✗ not selected'}`);
        return;
      }
    } else if (!firmwareFile) {
      addLog('No firmware file selected');
      return;
    }

    let fileEntries: { data: string; address: number }[] = [];

    try {
      setIsFlashing(true);
      setProgress(0);
      addLog('Starting flash process...');

      if (flashFullFirmware) {
        // ── Full flash: bootloader + partition table + app ──
        // At this point bootloaderFile, partitionTableFile, and firmwareFile
        // are guaranteed non-null by the check above.
        addLog('Full flash selected: writing bootloader + partition table + app');

        const bootloaderBuf = await bootloaderFile!.arrayBuffer();
        const partitionTableBuf = await partitionTableFile!.arrayBuffer();
        const appBuf = await firmwareFile!.arrayBuffer();

        fileEntries = [
          { data: arrayBufferToBinaryString(bootloaderBuf), address: BOOTLOADER_ADDRESS },
          { data: arrayBufferToBinaryString(partitionTableBuf), address: PARTITION_TABLE_ADDRESS },
          { data: base64ToBinaryString(BOOT_APP0_BASE64), address: OTADATA_ADDRESS },
          { data: arrayBufferToBinaryString(appBuf), address: APP_ADDRESS },
        ];

        addLog(`Bootloader: ${bootloaderFile!.name} - ${(bootloaderBuf.byteLength / 1024).toFixed(2)} KB @ 0x0`);
        addLog(`Partition table: ${partitionTableFile!.name} - ${(partitionTableBuf.byteLength / 1024).toFixed(2)} KB @ 0x8000`);
        addLog(`OTA selector: boot_app0.bin - 8.00 KB @ 0xe000`);
        addLog(`App: ${firmwareFile!.name} - ${(appBuf.byteLength / 1024).toFixed(2)} KB @ 0x10000`);
      } else {
        // ── Default behavior: app only, at the configured address ──
        const addrStr = flashAddress.trim();
        const isValidAddr = /^0x[0-9a-fA-F]+$/.test(addrStr);
        if (!isValidAddr) {
          addLog('Error: Invalid flash address. Use hex like 0x10000');
          setIsFlashing(false);
          return;
        }

        const address = parseInt(addrStr, 16);

        // A "*.ino.merged.bin" (arduino-cli --export-binaries output) is a
        // single pre-combined image that already contains the bootloader,
        // partition table, otadata, and app laid out at their correct
        // absolute offsets, sized to the full flash - it's meant to be
        // written whole starting at 0x0. The overlap guard below exists to
        // stop an *app-only* binary from accidentally overwriting the
        // bootloader/partition-table region, so it must not apply here.
        const isMergedImage = isMergedImageName(firmwareFile!.name);

        if (isMergedImage && address !== 0x0) {
          addLog(`Error: "${firmwareFile!.name}" is a merged image and must be flashed at 0x0.`);
          addLog(`   Set the flash address to 0x0, or reload it - merged images auto-set this.`);
          setIsFlashing(false);
          return;
        }

        // Guard against accidentally overwriting the bootloader/partition
        // table region when only flashing a single app binary.
        if (!isMergedImage && address < PARTITION_TABLE_ADDRESS + 0x1000) {
          addLog('Error: This address overlaps the bootloader/partition table region.');
          addLog('   Enable "Flash Complete Firmware" to write all components safely,');
          addLog('   or use an address of 0x10000 or higher for app-only flashing.');
          setIsFlashing(false);
          return;
        }

        if (isMergedImage) {
          addLog(`Merged image detected: writing whole image @ 0x0 (bootloader + partition table + app included)`);
        }

        const arrayBuffer = await firmwareFile!.arrayBuffer();
        addLog(`File size: ${arrayBuffer.byteLength} bytes`);

        fileEntries = [{
          data: arrayBufferToBinaryString(arrayBuffer),
          address
        }];
      }

      const esploader = espLoaderRef.current;

      addLog(`Writing ${fileEntries.length} file(s) to device...`);
      setProgress(10);

      // Byte-weighted progress tracking. esptool-js's reportProgress gives a
      // (fileIndex, written, total) triple where written/total is the
      // *current file's own* completion fraction - not a global one. Since
      // the bootloader/partition-table/app files can differ hugely in size
      // (the app is typically much larger), weighting every file as an
      // equal 1/N share of the bar makes progress jump through small files
      // and stall on the big one. Instead we weight each file's
      // contribution by its share of total (uncompressed) bytes so the bar
      // advances at a rate proportional to actual data written, whether
      // this is a single-file app flash or a 3-file full flash.
      const fileSizes = fileEntries.map(f => f.data.length);
      const totalBytes = fileSizes.reduce((sum, size) => sum + size, 0);
      const cumulativeBytes = fileSizes.reduce<number[]>((acc, size, i) => {
        acc.push(i === 0 ? 0 : acc[i - 1] + fileSizes[i - 1]);
        return acc;
      }, []);

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
        fileArray: fileEntries,
        flashSize: 'keep',
        eraseAll: false,
        compress: true,
        flashMode: 'dio',
        flashFreq: '40m',
        reportProgress: (fileIndex: number, written: number, total: number) => {
          const bytesDone = cumulativeBytes[fileIndex] + fileSizes[fileIndex] * (written / total);
          const overallFraction = totalBytes > 0 ? bytesDone / totalBytes : 0;
          setProgress(Math.round(10 + overallFraction * 90));
        }
      });

      setProgress(100);
      addLog('✓ Flash completed successfully!');
      addLog('Finalizing flash process...');

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
      addLog('✓ Firmware flash complete');
      addLog('If the device is not responding:');
      addLog('   1. Press the RESET button on your ESP32-C6');
      addLog('   2. Wait 2-3 seconds');
      addLog('   3. The device will start with the new firmware');
      addLog('');
      addLog('Troubleshooting:');
      addLog("   • If device doesn't respond: Power cycle USB");
      addLog('   • To flash again: Click "Connect Device"');
      addLog('   • Check device in Bluetooth settings');

    } catch (error: unknown) {
      addLog(`Flash error: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
    // Block if flashing is in progress
    if (isFlashing) return;

    setIsFetchingGithub(true);
    try {
      addLog(`Fetching firmwares from GitHub: ${githubRepo}...`);
      const apiUrl = `https://api.github.com/repos/${githubRepo}/releases/latest`;

      let releasesData: LatestRelease | null = await fetchLatestRelease(NPG_LITE_SOURCE);
      if (releasesData?.assets) {
        addLog(`✓ Found release ${releasesData.tag}`);
      } else {
        releasesData = null;
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
              releasesData = fromGithubRelease(NPG_LITE_SOURCE, await response.json() as GithubRelease);
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
        .filter(asset => /\.ino\.merged\.bin$/i.test(asset.name))
        .map(asset => ({
          name: asset.name.replace(/\.ino\.merged\.bin$/i, ''),
          url: asset.url,
        }));

      if (firmwares.length === 0) {
        addLog('Warning: No merged firmware images (*.ino.merged.bin) found in the latest release');
        return;
      }

      setGithubFirmwares(firmwares);
      addLog(`✓ Found ${firmwares.length} firmware(s) in latest release`);

    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      addLog(`Error: ${errorMsg}`);
      addLog('\nYou can still flash firmware by:');
      addLog('1. Downloading .bin files manually from GitHub');
      addLog(`2. Visit: https://github.com/${githubRepo}/releases`);
      addLog('3. Use "Add Firmware" button to upload them');
    } finally {
      setIsFetchingGithub(false);
    }
  };

  // The merged filename a given project's release asset is stored under locally
  const mergedFileName = (projectName: string) => `${projectName}.ino.merged.bin`;

  // Download a project's merged.bin via the Cloudflare Worker proxy and select
  // it for flashing. A merged image already contains bootloader + partition
  // table + otadata + app at their correct absolute offsets, so it's saved and
  // flashed as a single file at 0x0 - no extraction or multi-file wiring needed.
  const downloadGithubFirmware = async (url: string, name: string) => {
    setDownloadingFirmware(name);
    setDownloadProgress('Initializing...');
    try {
      const fileName = mergedFileName(name);

      // Reuse the cached copy if this project was already downloaded before
      const alreadyCached = localFirmwares.some(f => f.name === fileName);
      if (alreadyCached) {
        addLog(`${fileName} already in storage - loading cached copy...`);
        const cachedBuf = await getFirmwareFromDB(fileName);
        if (cachedBuf) {
          setFirmwareFile(new File([cachedBuf], fileName, { type: 'application/octet-stream' }));
          setSelectedDefaultFirmware('');
          addLog(`✓ Loaded cached ${fileName} (${(cachedBuf.byteLength / 1024).toFixed(2)} KB)`);
          addLog(`✓ Merged image - flash address set to 0x0. Click "Flash Firmware" when device is connected.`);
          return;
        }
        addLog(`Warning: Cached copy missing/corrupt, re-downloading...`);
      }

      addLog(`Downloading ${fileName}...`);

      const commonHeaders = {
        'Accept': 'application/octet-stream, */*',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      };

      let arrayBuffer: ArrayBuffer | null = null;

      // Use Cloudflare Worker proxy
      try {
        setDownloadProgress('Downloading via Cloudflare Worker...');
        addLog(`Downloading via Cloudflare Worker...`);

        const response = await fetch(url, {
          method: 'GET',
          headers: commonHeaders,
          signal: AbortSignal.timeout(30000),
          mode: 'cors'
        });

        if (response.ok && response.status === 200) {
          const contentType = response.headers.get('content-type');
          if (contentType && contentType.includes('text/html')) {
            addLog(`Warning: Worker: Got HTML response, skipping`);
          } else {
            setDownloadProgress(`Saving firmware data...`);
            arrayBuffer = await response.arrayBuffer();

            if (arrayBuffer.byteLength > 1000) {
              addLog(`✓ Download successful via Cloudflare Worker (${(arrayBuffer.byteLength / 1024).toFixed(2)} KB)`);
            } else {
              addLog(`Warning: Worker: Response too small (${arrayBuffer.byteLength} bytes), may be invalid`);
            }
          }
        } else {
          addLog(`Warning: Worker responded with status: ${response.status}`);
        }
      } catch (error: unknown) {
        console.log('Cloudflare Worker download failed:', error);
        addLog(`Warning: Cloudflare Worker failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }

      if (!arrayBuffer || arrayBuffer.byteLength < 1000) {
        addLog(`Error: Download failed for ${fileName}`);
        throw new Error(`Download failed. Please use manual download option.`);
      }

      setDownloadProgress('Saving to storage...');
      addLog(`Saving to browser storage...`);
      // Tagged so it's listed under the GitHub projects, not "Your firmwares"
      await saveFirmwareToDB(fileName, arrayBuffer, 'github');
      await loadLocalFirmwares();

      setFirmwareFile(new File([arrayBuffer], fileName, { type: 'application/octet-stream' }));
      setSelectedDefaultFirmware('');

      addLog(`✓ Successfully downloaded and saved ${fileName} (${(arrayBuffer.byteLength / 1024).toFixed(2)} KB)`);
      addLog(`✓ Merged image - flash address set to 0x0. Click "Flash Firmware" when device is connected.`);

    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      addLog(`Download error: ${errorMsg}`);
      addLog(`\nManual download instructions:`);
      addLog(`   1. Visit: https://github.com/${githubRepo}/releases/latest`);
      addLog(`   2. Find and download "${mergedFileName(name)}"`);
      addLog(`   3. Use "Add Firmware" to upload it - the flasher auto-detects merged images`);
    } finally {
      setDownloadingFirmware(null);
      setDownloadProgress('');
    }
  };

  // Saves every NPG Lite project that isn't stored yet, one after another.
  // The current selection is left alone.
  const downloadAllGithubFirmwares = async () => {
    if (isFlashing || downloadAllProgress || downloadingFirmware) return;
    const saved = new Set(localFirmwares.map(f => f.name));
    const todo = githubFirmwares.filter(g => !saved.has(mergedFileName(g.name)));
    if (todo.length === 0) {
      addLog('✓ All NPG Lite projects are already saved');
      return;
    }

    addLog(`Downloading ${todo.length} NPG Lite project(s)...`);
    const failed: string[] = [];
    setDownloadAllProgress({ done: 0, total: todo.length });
    for (const [i, project] of todo.entries()) {
      const fileName = mergedFileName(project.name);
      setDownloadingFirmware(project.name);
      setDownloadProgress(`${i + 1} of ${todo.length}`);
      try {
        const response = await fetch(project.url, { signal: AbortSignal.timeout(60000), mode: 'cors' });
        const contentType = response.headers.get('content-type') || '';
        if (!response.ok || contentType.includes('text/html')) throw new Error(`status ${response.status}`);
        const data = await response.arrayBuffer();
        if (data.byteLength < 1000) throw new Error('response too small');
        // Tagged so it's listed under the GitHub projects, not "Your firmwares"
        await saveFirmwareToDB(fileName, data, 'github');
        // Mark the row as saved now; the full list is reloaded once at the end
        setLocalFirmwares(prev => [
          ...prev.filter(f => f.name !== fileName),
          { name: fileName, size: data.byteLength, timestamp: Date.now(), type: 'github' },
        ]);
        addLog(`✓ Saved ${fileName} (${(data.byteLength / 1024).toFixed(2)} KB)`);
      } catch (error: unknown) {
        failed.push(project.name);
        addLog(`Warning: Could not download ${fileName}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
      setDownloadAllProgress({ done: i + 1, total: todo.length });
    }
    setDownloadingFirmware(null);
    setDownloadProgress('');
    setDownloadAllProgress(null);
    await loadLocalFirmwares();
    addLog(failed.length === 0
      ? `✓ Saved all ${todo.length} NPG Lite project(s)`
      : `Warning: Saved ${todo.length - failed.length} of ${todo.length}. Failed: ${failed.join(', ')}`);
  };

  const loadFirmwareFromStorage = async (name: string) => {
    // Block if flashing is in progress
    if (isFlashing) return;

    try {
      addLog(`Loading ${name} from storage...`);
      const arrayBuffer = await getFirmwareFromDB(name);

      if (arrayBuffer) {
        const file = new File([arrayBuffer], name, { type: 'application/octet-stream' });
        setFirmwareFile(file);
        // Clear default selection if loading a custom firmware
        const isDefault = DEFAULT_FIRMWARES.some(f => f.name === name);
        setSelectedDefaultFirmware(isDefault ? DEFAULT_FIRMWARES.find(f => f.name === name)?.type || '' : '');
        // Flash address is set automatically based on the filename by the
        // effect watching firmwareFile (merged → 0x0, app → 0x10000, etc.)
        addLog(`✓ Loaded ${name} (${(arrayBuffer.byteLength / 1024).toFixed(2)} KB)`);
      } else {
        addLog(`Error: Firmware ${name} not found in storage`);
      }
    } catch (error: unknown) {
      addLog(`Error loading firmware: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const deleteFirmwareFromStorage = async (name: string) => {
    // Block if flashing is in progress
    if (isFlashing) return;

    try {
      // Check if it's a default firmware
      const isDefault = DEFAULT_FIRMWARES.some(f => f.name === name);
      if (isDefault) {
        addLog(`Warning: Cannot delete default firmware: ${name}`);
        return;
      }

      await deleteFirmwareFromDB(name);
      await loadLocalFirmwares();
      addLog(`Deleted ${name} from storage`);

      if (firmwareFile && firmwareFile.name === name) {
        setFirmwareFile(null);
        setSelectedDefaultFirmware('');
      }
      if (bootloaderFile && bootloaderFile.name === name) {
        setBootloaderFile(null);
      }
      if (partitionTableFile && partitionTableFile.name === name) {
        setPartitionTableFile(null);
      }
    } catch (error: unknown) {
      addLog(`Error deleting firmware: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const clearAllFirmwares = async () => {
    // Block if flashing is in progress
    if (isFlashing) return;

    try {
      if (confirm('Delete all firmwares you added? Default and GitHub firmwares are kept.')) {
        addLog('Clearing your firmwares...');

        // Only the user's own uploads - not defaults or saved GitHub projects
        const allFirmwares = await getAllFirmwaresFromDB();
        const customFirmwares = allFirmwares.filter(f => !f.isDefault && !isGithubFile(f));

        // Delete custom firmwares one by one
        for (const firmware of customFirmwares) {
          await deleteFirmwareFromDB(firmware.name);
        }

        await loadLocalFirmwares();

        // Clear selection if it was a custom firmware
        if (firmwareFile && !DEFAULT_FIRMWARES.some(f => f.name === firmwareFile.name)) {
          setFirmwareFile(null);
          setSelectedDefaultFirmware('');
        }

        addLog(`✓ Cleared ${customFirmwares.length} custom firmware(s) from storage`);
      }
    } catch (error: unknown) {
      addLog(`Error clearing storage: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  // Derived: all interactive firmware controls should be locked while flashing
  const firmwareControlsDisabled = isFlashing || isLoadingDefaults;

  const selectedIsMergedImage = !!firmwareFile && isMergedImageName(firmwareFile.name);

  // Saved GitHub projects: tagged 'github' when downloaded (older downloads
  // are recognised by matching a project in the current release list).
  const githubFileNames = new Set(githubFirmwares.map(g => mergedFileName(g.name)));
  const isGithubFile = (f: FirmwareInfo) => f.type === 'github' || githubFileNames.has(f.name);
  const allProjectsSaved = githubFirmwares.length > 0 &&
    githubFirmwares.every(g => localFirmwares.some(f => f.name === mergedFileName(g.name)));
  // Saved projects that are no longer in the latest release
  const savedGithubOrphans = localFirmwares.filter(f => f.type === 'github' && !githubFileNames.has(f.name));

  // "Your firmwares": everything the user added themselves
  const userFirmwares = localFirmwares.filter(
    f => !f.isDefault && !isGithubFile(f) && f.type !== 'bootloader' && f.type !== 'partition-table'
  );

  // Bootloader/partition-table files are hidden from the main sidebar above,
  // so custom (non-default) ones need somewhere to be cleaned up - surfaced
  // in the full-flash section instead, right next to where they're selected.
  const customBootloaderPartitionFiles = localFirmwares.filter(
    f => (f.type === 'bootloader' || f.type === 'partition-table') && !f.isDefault
  );

  // Full-flash dropdowns only offer files named the standard way:
  // Arduino IDE exports <sketch>.ino.bootloader.bin / <sketch>.ino.partitions.bin,
  // ESP-IDF builds bootloader.bin / partition-table.bin. Merged images already
  // contain both, so they're never offered here.
  const bootloaderCandidates = localFirmwares.filter(
    f => /bootloader/i.test(f.name) && !isMergedImageName(f.name)
  );
  // App-only files (not merged images, bootloaders or partition tables)
  const appCandidates = localFirmwares.filter(
    f => !isMergedImageName(f.name) && !/bootloader|partition/i.test(f.name)
  );
  const partitionTableCandidates = localFirmwares.filter(
    f => /partition/i.test(f.name) && !isMergedImageName(f.name)
  );

  return (
    <div className="min-h-dvh desk:h-dvh desk:overflow-hidden flex flex-col gap-4 bg-neutral-950 bg-[radial-gradient(ellipse_at_top_left,rgba(37,99,235,0.18),transparent_55%),radial-gradient(ellipse_at_bottom_right,rgba(124,58,237,0.14),transparent_55%)] text-neutral-100 p-4">
      {/* Navbar: app name + device connection */}
      <header className="-mx-4 -mt-4 flex flex-wrap items-center justify-between gap-4 border-b border-neutral-800 bg-neutral-950/70 px-6 py-3 backdrop-blur">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold tracking-tight text-neutral-50">Neuro PlayGround (NPG) Lite Firmware Flasher</h1>
          <p className="truncate text-xs text-neutral-500">Works in Chrome, Edge, Opera and Firefox 151+ on desktop</p>
        </div>
        <div className="connection-section flex items-center gap-3">
          <a
            href={FLASHER_REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            title="NPG Lite Flasher on GitHub"
            className="rounded-lg p-2 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100 transition-colors"
          >
            <GithubMark className="h-5 w-5" />
          </a>
          <div className="flex items-center gap-2 rounded-full border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-xs">
            <span className={`h-2 w-2 rounded-full ${isConnected ? 'bg-emerald-500' : 'bg-neutral-600'}`} />
            <span className={isConnected ? 'text-neutral-200' : 'text-neutral-400'}>
              {isConnected ? `${chipInfo || 'Device'} connected` : 'Not connected'}
            </span>
          </div>
          {!isConnected ? (
            <button
              onClick={connectToDevice}
              disabled={isFlashing}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-neutral-800 disabled:text-neutral-500 disabled:cursor-not-allowed text-white rounded-lg text-sm font-semibold shadow-sm transition-colors"
            >
              Connect Device
            </button>
          ) : (
            <button
              onClick={disconnectDevice}
              disabled={isFlashing}
              className="px-4 py-2 border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 text-red-300 disabled:cursor-not-allowed disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
            >
              Disconnect
            </button>
          )}
        </div>
      </header>

      <div className="flex-1 min-h-0 flex flex-col desk:flex-row gap-4">
        {/* Firmware sources: defaults + yours, and NPG Lite projects */}
        <div className="firmware-selection flex flex-col desk:flex-row gap-4 flex-shrink-0 min-h-0">
          {/* Column 1: default firmwares on top, your firmwares below */}
          <aside className="w-full desk:w-[22rem] min-h-0 flex flex-col bg-neutral-900/60 rounded-xl border border-neutral-800">
            <div className="flex-1 min-h-0 flex flex-col gap-6 p-5">
            <section className="default-firmwares-section flex-shrink-0">
              <div className="mb-2 flex items-center justify-between gap-3">
              <label className="block text-sm font-medium text-neutral-300">
                Default firmwares
                {prebuiltVersion && (
                  <span className="ml-2 text-xs text-neutral-500 font-normal">({prebuiltVersion})</span>
                )}
                {isFlashing && (
                  <span className="ml-2 normal-case tracking-normal text-amber-300 font-normal">
                    (locked during flash)
                  </span>
                )}
              </label>
                <a
                  href={`https://github.com/${PREBUILT_FIRMWARE_REPO}/releases/latest`}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Open on GitHub"
                  className="flex-shrink-0 rounded-md p-1.5 text-neutral-400 hover:bg-violet-500/10 hover:text-violet-300 transition-colors"
                >
                  <GithubMark className="h-4 w-4" />
                </a>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {/* ── BLE button ── */}
                <button
                  onClick={() => loadDefaultFirmware('ble')}
                  disabled={firmwareControlsDisabled || selectedDefaultFirmware === 'ble'}
                  title="Wireless"
                  className={`px-3 py-2.5 rounded-lg border transition-colors ${selectedDefaultFirmware === 'ble'
                      ? 'bg-blue-500/15 border-blue-500/70 ring-1 ring-blue-500/30 cursor-default'
                      : firmwareControlsDisabled
                        ? 'bg-neutral-950/50 border-neutral-800 cursor-not-allowed opacity-50'
                        : 'bg-neutral-950/50 border-neutral-800 hover:border-blue-500/50 hover:bg-blue-500/5'
                    }`}
                >
                  <div className="flex items-center justify-center gap-2">
                    {isLoadingDefaults ? (
                      <Loader2 className="h-4 w-4 text-neutral-400 animate-spin" />
                    ) : (
                      <Bluetooth className="h-4 w-4 text-blue-400" />
                    )}
                    <span className="text-sm font-medium text-neutral-100">BLE</span>
                  </div>
                </button>

                {/* ── WiFi button ── */}
                <button
                  onClick={() => loadDefaultFirmware('wifi')}
                  disabled={firmwareControlsDisabled || selectedDefaultFirmware === 'wifi'}
                  title="Wireless"
                  className={`px-3 py-2.5 rounded-lg border transition-colors ${selectedDefaultFirmware === 'wifi'
                      ? 'bg-emerald-500/15 border-emerald-500/70 ring-1 ring-emerald-500/30 cursor-default'
                      : firmwareControlsDisabled
                        ? 'bg-neutral-950/50 border-neutral-800 cursor-not-allowed opacity-50'
                        : 'bg-neutral-950/50 border-neutral-800 hover:border-emerald-500/50 hover:bg-emerald-500/5'
                    }`}
                >
                  <div className="flex items-center justify-center gap-2">
                    {isLoadingDefaults ? (
                      <Loader2 className="h-4 w-4 text-neutral-400 animate-spin" />
                    ) : (
                      <Wifi className="h-4 w-4 text-emerald-400" />
                    )}
                    <span className="text-sm font-medium text-neutral-100">WiFi</span>
                  </div>
                </button>

                {/* ── Serial button ── */}
                <button
                  onClick={() => loadDefaultFirmware('serial')}
                  disabled={firmwareControlsDisabled || selectedDefaultFirmware === 'serial'}
                  title="Direct USB"
                  className={`px-3 py-2.5 rounded-lg border transition-colors ${selectedDefaultFirmware === 'serial'
                      ? 'bg-violet-500/15 border-violet-500/70 ring-1 ring-violet-500/30 cursor-default'
                      : firmwareControlsDisabled
                        ? 'bg-neutral-950/50 border-neutral-800 cursor-not-allowed opacity-50'
                        : 'bg-neutral-950/50 border-neutral-800 hover:border-violet-500/50 hover:bg-violet-500/5'
                    }`}
                >
                  <div className="flex items-center justify-center gap-2">
                    {isLoadingDefaults ? (
                      <Loader2 className="h-4 w-4 text-neutral-400 animate-spin" />
                    ) : (
                      <Usb className="h-4 w-4 text-violet-400" />
                    )}
                    <span className="text-sm font-medium text-neutral-100">Serial</span>
                  </div>
                </button>
              </div>
            </section>

            {/* Firmwares the user added */}
            <section
              {...dropZone('list')}
              className="local-firmwares-section relative h-[22rem] desk:h-auto desk:flex-1 desk:basis-0 min-h-0 flex flex-col border-t border-neutral-800 pt-5"
            >
              {dropTarget === 'list' && (
                <div className="pointer-events-none absolute inset-0 top-2 z-10 flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-emerald-500/60 bg-neutral-950">
                  <CloudDownload className="h-7 w-7 text-emerald-400" strokeWidth={1.5} />
                  <p className="text-sm font-medium text-emerald-300">Drop .bin files to add them</p>
                </div>
              )}
              <div className="mb-2 flex flex-shrink-0 items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <h2 className="whitespace-nowrap text-sm font-medium text-neutral-300">Your firmwares</h2>
                  {userFirmwares.length > 0 && (
                    <span className="px-1.5 py-0.5 border border-blue-500/30 bg-blue-500/10 text-blue-300 rounded-full text-[0.625rem] tabular-nums">
                      {userFirmwares.length}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {userFirmwares.length > 0 && (
                    <button
                      onClick={clearAllFirmwares}
                      disabled={isFlashing}
                      title="Delete All"
                      className="rounded-md p-1.5 text-neutral-400 hover:bg-red-500/10 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                  <button
                    onClick={() => setShowAddFirmwareDialog(true)}
                    disabled={isFlashing}
                    className="add-firmware-btn flex items-center gap-1.5 whitespace-nowrap px-2.5 py-1.5 border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 disabled:cursor-not-allowed disabled:opacity-50 rounded-lg text-xs font-medium transition-colors"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add Firmware
                  </button>
                </div>
              </div>

              {userFirmwares.length === 0 ? (
                <div className="flex flex-1 min-h-0 flex-col items-center justify-center rounded-lg border border-dashed border-neutral-700 bg-neutral-950/50 p-4 text-center">
                  <FileText className="h-8 w-8 text-neutral-700 mx-auto mb-2" strokeWidth={1.25} />
                  <p className="text-sm text-neutral-400">No firmwares added yet</p>
                  <p className="mt-1 text-xs text-neutral-500">Drag .bin files here or click Add Firmware. They&apos;re saved in this browser.</p>
                </div>
              ) : (
                <div className="space-y-1 flex-1 min-h-0 overflow-y-auto pr-1 custom-scrollbar">
                  {userFirmwares.map((firmware) => {
                    const isSelected = firmwareFile?.name === firmware.name;
                    const pick = () => {
                      if (!isFlashing && !isSelected) loadFirmwareFromStorage(firmware.name);
                    };
                    return (
                      <div
                        key={firmware.name}
                        role="button"
                        tabIndex={0}
                        onClick={pick}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            pick();
                          }
                        }}
                        className={`firmware-list-item group flex items-center gap-2.5 rounded-lg border px-3 py-2 transition-colors
                          ${isFlashing ? 'opacity-50 pointer-events-none' : isSelected ? 'cursor-default' : 'cursor-pointer'}
                          ${isSelected
                            ? 'border-emerald-500/50 bg-emerald-500/10'
                            : 'border-neutral-800 bg-neutral-950/40 hover:border-blue-500/40 hover:bg-blue-500/5'
                          }`}
                      >
                        <p
                          className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-100"
                          title={`${firmware.name}, added ${new Date(firmware.timestamp).toLocaleDateString()}`}
                        >
                          {firmware.name}
                        </p>
                        <span className={`flex-shrink-0 text-xs ${isSelected ? 'text-emerald-400' : 'text-neutral-500'}`}>
                          {isSelected ? 'Selected' : `${(firmware.size / 1024).toFixed(1)} KB`}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteFirmwareFromStorage(firmware.name);
                          }}
                          disabled={isFlashing}
                          title="Delete"
                          className="flex-shrink-0 rounded-md p-1 text-neutral-500 hover:bg-red-500/10 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
            </div>

          {isFlashing && (
            <div className="mx-5 mb-5 flex items-center gap-2 px-3 py-2 bg-amber-500/10 border border-amber-500/30 rounded-lg">
              <Loader2 className="h-4 w-4 text-amber-300 animate-spin flex-shrink-0" />
              <p className="text-amber-200 text-xs font-medium">
                Firmware selection locked during flashing
              </p>
            </div>
          )}
          </aside>

          {/* Column 2: NPG Lite projects, full height */}
          <aside className="w-full desk:w-[20rem] min-h-0 flex flex-col bg-neutral-900/60 rounded-xl border border-neutral-800 p-5">
            {/* NPG Lite projects from the GitHub release */}
            <section className="github-firmware-btn h-[26rem] desk:h-auto desk:flex-1 min-h-0 flex flex-col">
              <div className="mb-2 flex flex-shrink-0 items-center justify-between gap-3">
                <h2 className="min-w-0 truncate text-sm font-medium text-neutral-300">NPG Lite projects</h2>
                <div className="flex flex-shrink-0 items-center gap-0.5">
                  <a
                    href={`https://github.com/${githubRepo}/releases/latest`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Open on GitHub"
                    className="rounded-md p-1.5 text-neutral-400 hover:bg-violet-500/10 hover:text-violet-300 transition-colors"
                  >
                    <GithubMark className="h-4 w-4" />
                  </a>
                  <button
                    onClick={downloadAllGithubFirmwares}
                    disabled={isFlashing || !!downloadAllProgress || !!downloadingFirmware || githubFirmwares.length === 0 || allProjectsSaved}
                    title={downloadAllProgress
                      ? `Downloading ${downloadAllProgress.done} of ${downloadAllProgress.total}...`
                      : allProjectsSaved ? 'All projects are saved in this browser' : 'Download all projects'}
                    aria-label="Download all projects"
                    className="flex items-center gap-1.5 rounded-md p-1.5 text-xs text-neutral-400 hover:bg-violet-500/10 hover:text-violet-300 disabled:cursor-not-allowed disabled:hover:bg-transparent transition-colors"
                  >
                    {downloadAllProgress ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin text-violet-300" />
                        <span className="tabular-nums text-violet-300">{downloadAllProgress.done}/{downloadAllProgress.total}</span>
                      </>
                    ) : allProjectsSaved ? (
                      <Check className="h-4 w-4 text-emerald-400" />
                    ) : (
                      <FileDown className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>

              {githubFirmwares.length === 0 ? (
                <div className="flex flex-1 min-h-0 flex-col items-center justify-center rounded-lg border border-dashed border-neutral-700 bg-neutral-950/50 p-4 text-center">
                  {isFetchingGithub ? (
                    <p className="flex items-center justify-center gap-2 text-sm text-neutral-400">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading projects...
                    </p>
                  ) : (
                    <>
                      <p className="text-sm text-neutral-400">Couldn&apos;t load the project list</p>
                      <button
                        onClick={fetchGithubReleases}
                        disabled={isFlashing}
                        className="mt-3 px-3 py-1.5 border border-violet-500/30 bg-violet-500/10 hover:bg-violet-500/20 text-violet-300 disabled:cursor-not-allowed disabled:opacity-50 rounded-lg text-xs font-medium transition-colors"
                      >
                        Try Again
                      </button>
                    </>
                  )}
                </div>
              ) : (
                <div className="space-y-1 flex-1 min-h-0 overflow-y-auto pr-1 custom-scrollbar">
                  {githubFirmwares.map((firmware) => {
                    const fileName = mergedFileName(firmware.name);
                    const isDownloading = downloadingFirmware === firmware.name;
                    const isInStorage = localFirmwares.some(f => f.name === fileName);
                    const isSelected = firmwareFile?.name === fileName;
                    const pick = () => {
                      if (!isDownloading && !isFlashing && !downloadAllProgress) downloadGithubFirmware(firmware.url, firmware.name);
                    };

                    return (
                      <div
                        key={firmware.name}
                        role="button"
                        tabIndex={0}
                        onClick={pick}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            pick();
                          }
                        }}
                        className={`group flex items-center gap-2.5 rounded-lg border px-3 py-2 transition-colors
                          ${isFlashing ? 'opacity-50 pointer-events-none' : 'cursor-pointer'}
                          ${isSelected
                            ? 'border-emerald-500/50 bg-emerald-500/10'
                            : isDownloading
                              ? 'border-violet-500/40 bg-violet-500/10'
                              : 'border-neutral-800 bg-neutral-950/40 hover:border-violet-500/40 hover:bg-violet-500/5'
                          }`}
                      >
                        {isDownloading ? (
                          <Loader2 className="h-4 w-4 flex-shrink-0 text-violet-300 animate-spin" />
                        ) : isInStorage ? (
                          <Check className="h-4 w-4 flex-shrink-0 text-emerald-400" />
                        ) : (
                          <CloudDownload className="h-4 w-4 flex-shrink-0 text-violet-400" />
                        )}
                        <p className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-100">{firmware.name}</p>
                        <span className={`flex-shrink-0 text-xs ${isDownloading ? 'text-violet-300' : isSelected ? 'text-emerald-400' : 'text-neutral-500'}`}>
                          {isDownloading
                            ? downloadProgress || 'Downloading...'
                            : isSelected
                              ? 'Selected'
                              : isInStorage
                                ? 'Saved'
                                : 'Download'}
                        </span>
                        {isInStorage && !isDownloading && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteFirmwareFromStorage(fileName);
                            }}
                            disabled={isFlashing}
                            title="Delete"
                            className="flex-shrink-0 rounded-md p-1 text-neutral-500 opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-red-500/10 hover:text-red-300 transition"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    );
                  })}

                  {/* Saved projects that are no longer in the latest release */}
                  {savedGithubOrphans.map((f) => {
                    const isSelected = firmwareFile?.name === f.name;
                    return (
                      <div
                        key={f.name}
                        role="button"
                        tabIndex={0}
                        onClick={() => !isFlashing && loadFirmwareFromStorage(f.name)}
                        onKeyDown={(e) => {
                          if ((e.key === 'Enter' || e.key === ' ') && !isFlashing) {
                            e.preventDefault();
                            loadFirmwareFromStorage(f.name);
                          }
                        }}
                        className={`group flex items-center gap-2.5 rounded-lg border px-3 py-2 transition-colors
                          ${isFlashing ? 'opacity-50 pointer-events-none' : 'cursor-pointer'}
                          ${isSelected
                            ? 'border-emerald-500/50 bg-emerald-500/10'
                            : 'border-neutral-800 bg-neutral-950/40 hover:border-violet-500/40 hover:bg-violet-500/5'
                          }`}
                      >
                        <Check className="h-4 w-4 flex-shrink-0 text-emerald-400" />
                        <p className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-100">{f.name.replace(/\.ino\.merged\.bin$/i, '')}</p>
                        <span className={`flex-shrink-0 text-xs ${isSelected ? 'text-emerald-400' : 'text-neutral-500'}`} title="Saved earlier, not in the latest release">
                          {isSelected ? 'Selected' : 'Saved'}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteFirmwareFromStorage(f.name);
                          }}
                          disabled={isFlashing}
                          title="Delete"
                          className="flex-shrink-0 rounded-md p-1 text-neutral-500 opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-red-500/10 hover:text-red-300 transition"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </aside>
        </div>

        {/* Right: flashing on top, console below */}
        <main className="flex-1 min-w-0 min-h-0 flex flex-col gap-4">
          <section className="flash-panel desk:overflow-y-auto desk:flex-none custom-scrollbar bg-neutral-900/60 rounded-xl border border-neutral-800 p-5 space-y-3">
            <h2 className="text-base font-semibold text-neutral-100">Flash Firmware</h2>
            {/* Selected Firmware Display (this is the App file - required in both modes) */}
            <div className="selected-firmware-display">
              {firmwareFile ? (
                <div className="h-[5.25rem] flex items-center gap-3 px-4 bg-emerald-500/5 rounded-lg border border-emerald-500/40">
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-baseline gap-2">
                      <p className="truncate text-emerald-300 font-medium" title={firmwareFile.name}>{firmwareFile.name}</p>
                      <span className="flex-shrink-0 text-xs text-neutral-500">{(firmwareFile.size / 1024).toFixed(1)} KB</span>
                    </div>
                    <p className={`mt-1 line-clamp-2 text-xs ${describeFirmware(firmwareFile.name) ? 'text-neutral-400' : 'text-neutral-600'}`}>
                      {describeFirmware(firmwareFile.name) ?? 'No description available yet.'}
                    </p>
                  </div>
                  {/* ── Clear selection: disabled while flashing ── */}
                  <button
                    onClick={() => {
                      if (isFlashing) return;
                      setFirmwareFile(null);
                      setSelectedDefaultFirmware('');
                    }}
                    disabled={isFlashing}
                    title="Clear selection"
                    className="flex-shrink-0 rounded-md p-1 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
              ) : (
                <div className="h-[5.25rem] flex flex-col items-center justify-center px-4 bg-neutral-950/50 rounded-lg border border-dashed border-neutral-700 text-center">
                  <p className="text-sm text-neutral-400">No firmware selected</p>
                  <p className="mt-1 text-xs text-neutral-500">Pick a default firmware, an NPG Lite project or one of your own.</p>
                </div>
              )}
            </div>

            <div className="full-flash-option flex items-start gap-3 px-4 py-3 min-h-[8.5rem] sm:min-h-[6.25rem] desk:min-h-0 desk:h-[5.5rem] desk:overflow-hidden bg-neutral-950/50 rounded-lg border border-neutral-800">
              <div className="relative flex items-center mt-0.5">
                <input
                  type="checkbox"
                  id="flashFullFirmware"
                  checked={flashFullFirmware}
                  onChange={(e) => {
                    setFlashFullFirmware(e.target.checked);
                    setShowFullFlashDialog(e.target.checked);
                  }}
                  disabled={isFlashing || selectedIsMergedImage}
                  className="peer appearance-none h-5 w-5 shrink-0 rounded-md border-2 border-neutral-600 bg-neutral-900
             checked:bg-emerald-600 checked:border-emerald-600
             hover:border-neutral-400
             focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-900
             disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-neutral-600
             transition-colors duration-150 cursor-pointer"
                />
                {/* checkmark, only visible when checked */}
                <Check className="pointer-events-none absolute h-3.5 w-3.5 left-[0.1875rem] top-[0.1875rem] text-white opacity-0 peer-checked:opacity-100 transition-opacity" strokeWidth={3} />
              </div>

              <div className="min-w-0 flex-1">
              <label
                htmlFor="flashFullFirmware"
                className={`block text-sm text-neutral-300 ${selectedIsMergedImage ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
              >
                <span className="font-medium text-neutral-100">Flash Complete Firmware</span>
                {flashFullFirmware ? null : selectedIsMergedImage ? (
                  <span className="block text-xs text-blue-300/90 mt-1">
                    Not needed: this is a merged image, so the bootloader and partition table are already
                    included and it&apos;s flashed as one file at 0x0.
                  </span>
                ) : (
                  <span className="block text-xs text-neutral-400 mt-1">
                    For app-only files (<code>.ino.bin</code>) on a blank chip or a new partition scheme.
                    Otherwise flashing just the app is enough, and merged images (<code>.merged.bin</code>)
                    never need it.
                  </span>
                )}
              </label>
              {/* Full flash on: chosen bootloader/partition files (picked in a dialog) */}
              {flashFullFirmware && (
                <div className="full-flash-required-files mt-1.5 flex items-end justify-between gap-4">
                  <div className="min-w-0 space-y-1 text-xs">
                    <p className="truncate">
                      <span className="text-neutral-500">Bootloader: </span>
                      {bootloaderFile
                        ? <span className="text-emerald-400">{bootloaderFile.name}</span>
                        : <span className="text-amber-300">not selected</span>}
                    </p>
                    <p className="truncate">
                      <span className="text-neutral-500">Partition table: </span>
                      {partitionTableFile
                        ? <span className="text-emerald-400">{partitionTableFile.name}</span>
                        : <span className="text-amber-300">not selected</span>}
                    </p>
                  </div>
                  <button
                    onClick={() => setShowFullFlashDialog(true)}
                    disabled={isFlashing}
                    className="flex-shrink-0 whitespace-nowrap px-3 py-1.5 border border-blue-500/30 bg-blue-500/10 hover:bg-blue-500/20 text-blue-300 disabled:cursor-not-allowed disabled:opacity-50 rounded-lg text-xs font-medium transition-colors"
                  >
                    {bootloaderFile && partitionTableFile ? 'Change Files' : 'Choose Files'}
                  </button>
                </div>
              )}
              </div>
            </div>

            {/* Advanced Options (popup) and the Flash button share one row */}
            <div className="flex items-center gap-4">
            <div className="flash-address-section relative flex-shrink-0">
              <button
                ref={advancedButtonRef}
                onClick={() => {
                  const rect = advancedButtonRef.current?.getBoundingClientRect();
                  if (rect) setAdvancedPopupPos({ left: rect.left, bottom: window.innerHeight - rect.top + 8 });
                  setShowAdvanced(!showAdvanced);
                }}
                disabled={isFlashing || flashFullFirmware}
                className="flex items-center gap-2 text-sm font-medium text-neutral-400 hover:text-neutral-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight className={`h-4 w-4 transition-transform ${showAdvanced ? 'rotate-90' : ''}`} />
                Advanced Options
              </button>

              {showAdvanced && !isFlashing && !flashFullFirmware && advancedPopupPos && (() => {
                const detected = firmwareFile ? detectAddressForFilename(firmwareFile.name) : null;
                const recommended = detected?.address ?? '0x10000';
                const isRecommended = flashAddress.trim().toLowerCase() === recommended.toLowerCase();
                return (
                  <div
                    className="advanced-popup fixed z-50 w-[22rem] overflow-hidden rounded-xl border border-neutral-700 bg-neutral-900 shadow-2xl shadow-black/60"
                    style={{ left: advancedPopupPos.left, bottom: advancedPopupPos.bottom }}
                  >
                    <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
                      <h3 className="text-sm font-semibold text-neutral-100">Advanced Options</h3>
                      <button
                        onClick={() => setShowAdvanced(false)}
                        title="Close"
                        className="rounded-md p-1 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200 transition-colors"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>

                    <div className="space-y-3 p-4">
                      <div>
                        <label htmlFor="flashAddressInput" className="mb-1.5 block text-xs font-medium text-neutral-400">
                          Flash address (hex)
                        </label>
                        <div className="flex gap-2">
                          <input
                            id="flashAddressInput"
                            type="text"
                            value={flashAddress}
                            onChange={(e) => setFlashAddress(e.target.value)}
                            onBlur={handleFlashAddressBlur}
                            placeholder="0x10000"
                            spellCheck={false}
                            className={`min-w-0 flex-1 rounded-lg border bg-neutral-950 px-3 py-2 font-mono text-sm text-neutral-100 focus:outline-none ${isRecommended
                              ? 'border-neutral-700 focus:border-blue-500'
                              : 'border-amber-500/50 focus:border-amber-400'
                              }`}
                            disabled={isFlashing}
                          />
                          <button
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => setFlashAddress(recommended)}
                            disabled={isRecommended}
                            className="flex-shrink-0 rounded-lg border border-neutral-700 px-3 py-2 text-xs font-medium text-neutral-300 hover:bg-neutral-800 disabled:cursor-default disabled:opacity-40 transition-colors"
                          >
                            Reset
                          </button>
                        </div>
                      </div>

                      <div className="flex items-start justify-between gap-3 rounded-lg bg-neutral-950/60 px-3 py-2.5 text-xs" title={addressAutoReason || undefined}>
                        <div className="min-w-0">
                          <p className="text-neutral-500">Recommended</p>
                          <p className="mt-0.5 text-neutral-400">
                            {detected ? ADDRESS_HINTS[detected.kind] : 'Default for app-only files.'}
                          </p>
                        </div>
                        <span className="flex-shrink-0 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-emerald-300">
                          {recommended}
                        </span>
                      </div>

                      <p className="flex gap-2 text-xs leading-relaxed text-neutral-500">
                        <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-400/80" />
                        <span>
                          A wrong address can stop the device from booting. Below 0x9000 is blocked except for merged
                          images; use Flash Complete Firmware for the bootloader and partition table.
                        </span>
                      </p>
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Flash Button */}
            <button
              onClick={flashFirmware}
              disabled={
                !isConnected ||
                isFlashing ||
                (flashFullFirmware
                  ? !bootloaderFile || !partitionTableFile || !firmwareFile
                  : !firmwareFile)
              }
              className="flash-button relative min-w-0 flex-1 overflow-hidden px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-neutral-800 disabled:text-neutral-500 disabled:cursor-not-allowed text-white rounded-lg text-sm font-semibold shadow-sm transition-colors"
            >
              {/* Progress fills the button while flashing */}
              {isFlashing && (
                <span
                  className="progress-section absolute inset-y-0 left-0 bg-emerald-500/40 transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              )}
              <span className={`relative block truncate whitespace-nowrap ${isFlashing ? 'text-neutral-100 tabular-nums' : ''}`}>
                {isFlashing ? `Flashing... ${progress}%` : flashFullFirmware ? 'Flash Complete Firmware' : 'Flash Firmware'}
              </span>
            </button>
            </div>
          </section>

          <section
          className="console-section relative h-[28rem] desk:h-auto desk:flex-1 desk:min-h-0 flex flex-col bg-neutral-900/60 rounded-xl "
          >
            {/* Clear, pinned to the console's top-right corner */}
            <button
              onClick={clearLogs}
              disabled={logs.length === 0}
              title="Clear console"
              className="absolute right-3 top-2.5 z-10 rounded-md border border-neutral-700 bg-neutral-900/90 px-2.5 py-1 text-xs font-medium text-neutral-300 backdrop-blur hover:bg-neutral-800 hover:text-neutral-100 disabled:cursor-default disabled:opacity-40 transition-colors"
            >
              Clear
            </button>
            <div className="bg-neutral-950 border border-neutral-800 rounded-lg px-4 py-3 pr-20 flex-1 overflow-y-auto font-mono text-xs leading-relaxed break-words min-h-0 custom-scrollbar">
              {logs.map((log, index) => (
                <div
                  key={index}
                  ref={index === logs.length - 1 ? lastLogRef : null}
                  className={`mb-1 whitespace-pre-wrap ${logLineClass(log)}`}
                >
                  {log}
                </div>
              ))}
            </div>
          </section>
        </main>
      </div>

      {/* Hidden file input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileUpload}
        accept=".bin"
        multiple
        className="hidden"
        disabled={isFlashing}
      />
      <input
        type="file"
        ref={fullFlashFileInputRef}
        onChange={handleFullFlashFileUpload}
        accept=".bin"
        multiple
        className="hidden"
        disabled={isFlashing}
      />

      {/* Flash complete firmware: pick bootloader + partition table */}
      {showFullFlashDialog && flashFullFirmware && !isFlashing && (() => {
        const parts = [
          {
            key: 'bootloader',
            title: 'Bootloader',
            address: '0x0',
            file: bootloaderFile,
            candidates: bootloaderCandidates,
            onPick: loadBootloaderFromStorage,
            empty: 'Not available',
          },
          {
            key: 'partition',
            title: 'Partition table',
            address: '0x8000',
            file: partitionTableFile,
            candidates: partitionTableCandidates,
            onPick: loadPartitionTableFromStorage,
            empty: 'Not available',
          },
          {
            key: 'app',
            title: 'App',
            address: '0x10000',
            file: firmwareFile,
            candidates: appCandidates,
            onPick: (name: string) => {
              if (name) {
                loadFirmwareFromStorage(name);
              } else {
                setFirmwareFile(null);
                setSelectedDefaultFirmware('');
              }
            },
            empty: 'Not available',
          },
        ];
        const readyCount = [bootloaderFile, partitionTableFile, firmwareFile].filter(Boolean).length;
        const statusDot = (ok: boolean) => ok ? (
          <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400">
            <Check className="h-3 w-3" strokeWidth={3} />
          </span>
        ) : (
          <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border border-dashed border-amber-500/50" />
        );

        return (
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setShowFullFlashDialog(false);
            }}
          >
            <div className="bg-neutral-900 rounded-xl shadow-2xl shadow-black/60 max-w-lg w-full border border-neutral-800 max-h-[85vh] flex flex-col overflow-hidden">
              <div className="border-b border-neutral-800 px-6 py-4 flex justify-between items-start gap-4 flex-shrink-0">
                <div>
                  <h2 className="text-lg font-semibold text-neutral-100">Flash Complete Firmware</h2>
                  <p className="mt-1 text-xs text-neutral-500">
                    Writes the bootloader, partition table and app, each to its own address.
                  </p>
                </div>
                <button
                  onClick={() => setShowFullFlashDialog(false)}
                  title="Close"
                  className="rounded-md p-1 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200 transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="p-6 space-y-3 overflow-y-auto custom-scrollbar">
                {parts.map((part) => (
                  <div
                    key={part.key}
                    className={`rounded-lg border px-4 py-3 ${part.file ? 'border-neutral-800 bg-neutral-950/50' : 'border-amber-500/30 bg-amber-500/5'}`}
                  >
                    <div className="mb-2 flex items-center gap-2.5">
                      {statusDot(!!part.file)}
                      <p className="flex-1 text-sm font-medium text-neutral-100">{part.title}</p>
                      <span className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-0.5 font-mono text-xs text-neutral-400">
                        {part.address}
                      </span>
                    </div>
                    <div className="relative">
                      <select
                        value={part.file?.name || ''}
                        onChange={(e) => part.onPick(e.target.value)}
                        disabled={isFlashing || part.candidates.length === 0}
                        className="w-full appearance-none rounded-lg border border-neutral-700 bg-neutral-950 py-2 pl-3 pr-9 text-sm text-neutral-100 focus:border-blue-500 focus:outline-none disabled:cursor-not-allowed disabled:text-neutral-500"
                      >
                        <option value="">
                          {part.candidates.length > 0 ? `Select ${part.key === 'app' ? 'an app' : `a ${part.title.toLowerCase()}`} file` : part.empty}
                        </option>
                        {part.candidates.map((f) => (
                          <option key={f.name} value={f.name}>
                            {f.name} ({(f.size / 1024).toFixed(1)} KB)
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
                    </div>
                  </div>
                ))}

                {(!bootloaderFile || !partitionTableFile || !firmwareFile) && (
                  <div className="flex items-center justify-between gap-4 rounded-lg border border-dashed border-neutral-700 px-4 py-3">
                    <p className="text-xs leading-relaxed text-neutral-500">
                      Use the <code>.ino.bin</code>, <code>.bootloader.bin</code> and <code>.partitions.bin</code>{' '}
                      from Arduino IDE&apos;s Export Compiled Binary. Bootloader and partition files are matched by
                      name.
                    </p>
                    <button
                      onClick={() => fullFlashFileInputRef.current?.click()}
                      className="flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20 transition-colors"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add Files
                    </button>
                  </div>
                )}

                {/* Bootloader/partition-table files don't appear in the main
                    lists (they aren't standalone apps), so this is the only
                    place to clean up old/unwanted ones. */}
                {customBootloaderPartitionFiles.length > 0 && (
                  <div className="border-t border-neutral-800 pt-3">
                    <p className="mb-2 text-xs font-medium text-neutral-400">
                      Saved bootloader and partition files ({customBootloaderPartitionFiles.length})
                    </p>
                    <div className="space-y-1">
                      {customBootloaderPartitionFiles.map((f) => (
                        <div
                          key={f.name}
                          className="flex items-center justify-between gap-2 rounded-md border border-neutral-800 bg-neutral-950/50 px-3 py-2"
                        >
                          <span className="truncate text-xs text-neutral-300">
                            {f.name} <span className="text-neutral-500">({(f.size / 1024).toFixed(1)} KB)</span>
                          </span>
                          <button
                            onClick={() => deleteFirmwareFromStorage(f.name)}
                            disabled={isFlashing}
                            title="Delete"
                            className="flex-shrink-0 rounded-md p-1 text-neutral-500 hover:bg-red-500/10 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="border-t border-neutral-800 px-6 py-4 flex items-center justify-between gap-4 flex-shrink-0">
                <p className={`text-xs ${readyCount === 3 ? 'text-emerald-400' : 'text-neutral-500'}`}>
                  {readyCount === 3 ? 'All 3 files ready' : `${readyCount} of 3 ready`}
                </p>
                <button
                  onClick={() => setShowFullFlashDialog(false)}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-semibold shadow-sm transition-colors"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Add Firmware Dialog */}
      {showAddFirmwareDialog && !isFlashing && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-neutral-900 rounded-xl shadow-2xl shadow-black/50 max-w-md w-full border border-neutral-800">
            <div className="border-b border-neutral-800 px-6 py-4 flex justify-between items-center">
              <h2 className="text-lg font-semibold text-neutral-100">Add Firmware</h2>
              <button
                onClick={() => setShowAddFirmwareDialog(false)}
                className="rounded-md p-1 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6">
              <div
                {...dropZone('dialog')}
                className={`add-firmware-dropzone text-center rounded-lg border-2 border-dashed px-6 py-8 transition-colors ${dropTarget === 'dialog'
                  ? 'border-emerald-500/70 bg-emerald-500/10'
                  : 'border-neutral-700 bg-neutral-950/40'
                  }`}
              >
                <CloudDownload className={`h-12 w-12 mx-auto mb-4 ${dropTarget === 'dialog' ? 'text-emerald-400' : 'text-emerald-400/70'}`} strokeWidth={1.25} />
                <p className="text-neutral-300 text-sm">
                  {dropTarget === 'dialog' ? 'Drop to add them' : 'Drag .bin files here'}
                </p>
                <p className="text-neutral-500 text-xs mt-1 mb-5">or</p>
                <button
                  onClick={triggerFileInput}
                  className="w-full px-6 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-neutral-800 disabled:text-neutral-500 disabled:cursor-not-allowed text-white rounded-lg text-sm font-semibold shadow-sm transition-colors"
                >
                  Choose Files
                </button>
              </div>
              <p className="text-neutral-500 text-xs mt-3 text-center">Firmwares are saved in this browser and listed under Your firmwares.</p>
            </div>
          </div>
        </div>
      )}

      <AppTour autoStart={false} />
    </div>
  );
}