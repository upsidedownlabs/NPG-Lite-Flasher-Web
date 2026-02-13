// components/AppTour.tsx
'use client';
import { driver, type DriveStep, type Driver } from 'driver.js';
import { useEffect, useRef } from 'react';

interface AppTourProps {
  autoStart?: boolean;
}

export function AppTour({ autoStart = false }: AppTourProps) {
  const driverRef = useRef<Driver | null>(null);

  useEffect(() => {
    const tourSteps: DriveStep[] = [
      {
        element: '.connection-section',
        popover: {
          title: '🔌 Device Connection',
          description: 'Start by connecting your NPG Lite device or ESP32 device. Click "Connect Device" and select the correct COM port when prompted.',
          side: 'bottom' as const,
          align: 'start' as const,
        },
      },
      {
        element: '.default-firmwares-section',
        popover: {
          title: '📱 Built-in Firmwares',
          description: 'Quickly select from three pre-built firmware versions: BLE (Bluetooth), WiFi, or Serial (direct USB). These are included with the app and will be stored locally.',
          side: 'bottom' as const,
          align: 'start' as const,
        },
      },
      {
        element: '.firmware-selection',
        popover: {
          title: '📦 Firmware Selection',
          description: 'Choose your firmware here. You can select built-in versions, add local .bin files, or download from GitHub releases.',
          side: 'bottom' as const,
          align: 'start' as const,
        },
      },
      {
        element: '.add-firmware-btn',
        popover: {
          title: '➕ Add Custom Firmware',
          description: 'Upload your own firmware .bin files from your computer. They will be saved in browser storage for future use and appear in the Local Firmwares list.',
          side: 'left' as const,
          align: 'start' as const,
        },
      },
      {
        element: '.github-firmware-btn',
        popover: {
          title: '🐙 Get from GitHub',
          description: 'Download the latest firmware releases directly from the official GitHub repository.',
          side: 'left' as const,
          align: 'start' as const,
        },
      },
      {
        element: '.selected-firmware-display',
        popover: {
          title: '✅ Selected Firmware',
          description: 'Currently selected firmware appears here. You can see the file name, size, and type. Click the X to clear selection.',
          side: 'bottom' as const,
          align: 'start' as const,
        },
      },
      {
        element: '.flash-address-section',
        popover: {
          title: '⚙️ Advanced Options',
          description: 'Set custom flash memory address (default is 0x10000 for application partition). Only change if you know what you\'re doing!',
          side: 'top' as const,
          align: 'start' as const,
        },
      },
      {
        element: '.flash-button',
        popover: {
          title: '🚀 Flash Firmware',
          description: 'Once device is connected and firmware is selected, click here to start the flashing process. Do not disconnect during flashing!',
          side: 'top' as const,
          align: 'center' as const,
        },
      },
      {
        element: '.console-section',
        popover: {
          title: '📟 Console Output',
          description: 'Watch real-time logs here during connection and flashing process. Clear logs with the Clear button if needed.',
          side: 'left' as const,
          align: 'start' as const,
        },
      },
      {
        element: '.local-firmwares-section',
        popover: {
          title: '💾 Local Firmware Storage',
          description: 'Manage all your firmwares here. Built-in firmwares (with colored badges) cannot be deleted. Custom firmwares can be loaded or deleted.',
          side: 'left' as const,
          align: 'start' as const,
        },
      },
      {
        element: '.firmware-list-item:first-child',
        popover: {
          title: '📂 Firmware Management',
          description: 'Each firmware shows its name, size, and date. Click "Load" to select it, or "Delete" to remove custom firmwares (built-in ones are protected).',
          side: 'left' as const,
          align: 'start' as const,
        },
      },
      {
        element: '.progress-section',
        popover: {
          title: '📊 Progress Tracking',
          description: 'Monitor flashing progress here. The green bar shows completion percentage. Wait for 100% before disconnecting!',
          side: 'top' as const,
          align: 'center' as const,
        },
      },
    ];

    driverRef.current = driver({
      showProgress: true,
      animate: true,
      overlayOpacity: 0.5,
      smoothScroll: false,
      allowClose: true,
      steps: tourSteps,
      popoverClass: 'driver-popover-custom',
      onDestroyed: () => {
        // Reset tour for next time
        setTimeout(() => {
          driverRef.current = driver({
            showProgress: true,
            animate: true,
            overlayOpacity: 0.5,
            smoothScroll: false,
            allowClose: true,
            steps: tourSteps,
            popoverClass: 'driver-popover-custom',
          });
        }, 100);
      }
    });

    if (autoStart) {
      setTimeout(() => {
        startTour();
      }, 2000);
    }

    return () => {
      driverRef.current?.destroy();
    };
  }, [autoStart]);

  const startTour = () => {
    if (driverRef.current) {
      driverRef.current.drive();
    }
  };

  return (
    <div className="fixed bottom-2 right-6 z-40 flex flex-col gap-2">
      <button
        onClick={startTour}
        className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-3 rounded-full shadow-lg font-medium transition-colors flex items-center gap-2"
        title="Start Guided Tour"
      >
        <span className="text-md">🎯</span>
        <span className="hidden sm:inline">Guide</span>
      </button>
      
 
    </div>
  );
}