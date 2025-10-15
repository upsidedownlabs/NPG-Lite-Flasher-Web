// components/AppTour.tsx
'use client';
import { driver, type DriveStep, type Driver } from 'driver.js';
import 'driver.js/dist/driver.css';
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
          description: 'Start by connecting your ESP32 device. Click "Connect Device" and select the correct COM port when prompted.',
          side: 'bottom' as const,
          align: 'start' as const,
        },
      },
      {
        element: '.firmware-selection',
        popover: {
          title: '📦 Firmware Selection',
          description: 'Choose your firmware here. You can add local .bin files or download from GitHub releases.',
          side: 'bottom' as const,
          align: 'start' as const,
        },
      },
      {
        element: '.add-firmware-btn',
        popover: {
          title: '➕ Add Local Firmware',
          description: 'Upload firmware .bin files from your computer. They will be saved in browser storage for future use.',
          side: 'left' as const,
          align: 'start' as const,
        },
      },
      {
        element: '.github-firmware-btn',
        popover: {
          title: '🐙 Get from GitHub',
          description: 'Download the latest firmware releases directly from the GitHub repository.',
          side: 'left' as const,
          align: 'start' as const,
        },
      },
      {
        element: '.flash-address-section',
        popover: {
          title: '⚙️ Flash Address',
          description: 'Advanced option: Set the flash memory address (usually 0x10000 for application partition).',
          side: 'top' as const,
          align: 'start' as const,
        },
      },
      {
        element: '.flash-button',
        popover: {
          title: '🚀 Flash Firmware',
          description: 'Once device is connected and firmware is selected, click here to start the flashing process.',
          side: 'top' as const,
          align: 'center' as const,
        },
      },
      {
        element: '.console-section',
        popover: {
          title: '📟 Console Output',
          description: 'Watch real-time logs here during connection and flashing process. Clear logs with the Clear button.',
          side: 'left' as const,
          align: 'start' as const,
        },
      },
      {
        element: '.local-firmwares-section',
        popover: {
          title: '💾 Local Storage',
          description: 'Manage your downloaded and uploaded firmwares. You can load your downloaded firmware for flashing. They persist between browser sessions.',          side: 'left' as const,
          align: 'start' as const,
        },
      },
      {
        element: '.progress-section',
        popover: {
          title: '📊 Progress Tracking',
          description: 'Monitor flashing progress here. Do not disconnect the device during this process!',
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
    driverRef.current?.drive();
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