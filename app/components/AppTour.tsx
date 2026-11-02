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
        element: '.connect-button',
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
          description: 'Every firmware you can flash is listed here: the Chords firmwares, NPG Lite projects from GitHub, and files you add yourself. Click one to select it.',
          side: 'right' as const,
          align: 'start' as const,
        },
      },
      {
        element: '.default-firmwares-section',
        popover: {
          title: 'Chords firmwares',
          description: 'Three firmwares for Chords Web and Chords Python: Chords BLE, Chords WiFi and Chords Serial. Pick the one for how you want to connect. They come from the latest Chords-Arduino-Firmware release and stay up to date automatically.',
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
    <button
      onClick={startTour}
      title="Start Guided Tour"
      aria-label="Start Guided Tour"
      className="flex items-center gap-1.5 rounded-lg border border-blue-500/30 bg-blue-500/10 p-1.5 desk:px-3 desk:py-1.5 text-sm font-medium text-blue-300 transition-colors hover:bg-blue-500/20 hover:text-blue-200"
    >
      <Compass className="h-4 w-4" />
      <span className="hidden desk:inline">Guide</span>
    </button>
  );
}
