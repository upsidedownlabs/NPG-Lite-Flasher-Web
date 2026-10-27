// components/AppTour.tsx
'use client';
import { driver, type DriveStep, type Driver } from 'driver.js';
import { useEffect, useRef } from 'react';
import { Compass } from 'lucide-react';

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
          title: 'Device connection',
          description: 'Start by connecting your NPG Lite device. Click "Connect Device" and select the correct COM port when prompted.',
          side: 'bottom' as const,
          align: 'end' as const,
        },
      },
      {
        element: '.firmware-selection',
        popover: {
          title: 'Firmware sources',
          description: 'Every firmware you can flash is listed here: the default builds, NPG Lite projects from GitHub, and files you add yourself. Click one to select it.',
          side: 'right' as const,
          align: 'start' as const,
        },
      },
      {
        element: '.default-firmwares-section',
        popover: {
          title: 'Default firmwares',
          description: 'The standard BLE, WiFi and Serial builds, downloaded from the latest Chords-Arduino-Firmware release and kept up to date automatically.',
          side: 'right' as const,
          align: 'start' as const,
        },
      },
      {
        element: '.github-firmware-btn',
        popover: {
          title: 'NPG Lite projects',
          description: 'Every project from the latest NPG-Lite-Arduino-Firmware release on GitHub. Click one to download and select it, or use the download-all icon to save every project at once. Saved projects stay in this browser for next time.',
          side: 'right' as const,
          align: 'start' as const,
        },
      },
      {
        element: '.local-firmwares-section',
        popover: {
          title: 'Your firmwares',
          description: 'Firmwares you added from your computer. Click one to select it, or delete the ones you no longer need.',
          side: 'right' as const,
          align: 'start' as const,
        },
      },
      {
        element: '.add-firmware-btn',
        popover: {
          title: 'Add Firmware',
          description: 'Upload your own .bin file. It is saved in this browser and listed under Your firmwares.',
          side: 'right' as const,
          align: 'start' as const,
        },
      },
      {
        element: '.selected-firmware-display',
        popover: {
          title: 'Selected firmware',
          description: 'The firmware that will be flashed: its file name, size and type. Click the X to clear the selection.',
          side: 'left' as const,
          align: 'start' as const,
        },
      },
      {
        element: '.flash-address-section',
        popover: {
          title: 'Advanced Options',
          description: 'The flash address is set automatically from the file name (0x0 for merged images, 0x10000 for app-only files). Only change it if you know what you\'re doing.',
          side: 'left' as const,
          align: 'start' as const,
        },
      },
      {
        element: '.flash-button',
        popover: {
          title: 'Flash Firmware',
          description: 'Once a device is connected and a firmware is selected, click here to start flashing. Do not disconnect during flashing!',
          side: 'top' as const,
          align: 'center' as const,
        },
      },
      {
        element: '.progress-section',
        popover: {
          title: 'Progress tracking',
          description: 'While flashing, the button fills up and shows the percentage. Wait for 100% before disconnecting.',
          side: 'top' as const,
          align: 'center' as const,
        },
      },
      {
        element: '.console-section',
        popover: {
          title: 'Console output',
          description: 'Live logs from connecting and flashing. Errors are shown in red and warnings in amber. Use Clear to empty it.',
          side: 'top' as const,
          align: 'start' as const,
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
        className="flex items-center gap-2 rounded-full border border-blue-500/40 bg-blue-600/90 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-blue-900/40 backdrop-blur transition-colors hover:bg-blue-500"
        title="Start Guided Tour"
      >
        <Compass className="h-4 w-4" />
        <span>Guide</span>
      </button>
      
 
    </div>
  );
}