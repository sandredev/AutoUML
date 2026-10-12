
import type { JSX, ReactNode } from 'react';

function Svg({ children }: { children: ReactNode }): JSX.Element {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const ReloadIcon = () => (
  <Svg>
    <path d="M21 12a9 9 0 1 1-2.64-6.36" />
    <path d="M21 3v6h-6" />
  </Svg>
);






export const SidebarIcon = () => (
  <Svg>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M9 4v16" />
  </Svg>
);

export const FolderIcon = () => (
  <Svg>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </Svg>
);

export const PlusIcon = () => (
  <Svg>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const CloseIcon = () => (
  <Svg>
    <path d="M18 6 6 18M6 6l12 12" />
  </Svg>
);



export const SearchIcon = () => (
  <Svg>
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.35-4.35" />
  </Svg>
);




export const CodeIcon = () => (
  <Svg>
    <path d="m8 7-5 5 5 5" />
    <path d="m16 7 5 5-5 5" />
    <path d="m13.5 4-3 16" />
  </Svg>
);

export const InspectorIcon = () => (
  <Svg>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M15 4v16" />
  </Svg>
);

export const MinusIcon = () => (
  <Svg>
    <path d="M6 12h12" />
  </Svg>
);

export const ChevronDownIcon = () => (
  <Svg>
    <path d="M6 9l6 6 6-6" />
  </Svg>
);

export const ChevronRightIcon = () => (
  <Svg>
    <path d="M9 6l6 6-6 6" />
  </Svg>
);

export const EyeIcon = () => (
  <Svg>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </Svg>
);

export const EyePlusIcon = () => (
  <Svg>
    <path d="M2 12s3.5-7 10-7c1.4 0 2.6.3 3.7.8M22 12s-3.5 7-10 7S2 12 2 12" />
    <circle cx="12" cy="12" r="3" />
    <path d="M19 2v6M16 5h6" />
  </Svg>
);

export const PinIcon = ({ filled = false }: { filled?: boolean }) => (
  <Svg>
    <path d="M9 4h6l-1 6 3 3H7l3-3-1-6z" fill={filled ? 'currentColor' : 'none'} />
    <path d="M12 13v7" />
  </Svg>
);

export const WarningIcon = () => (
  <Svg>
    <path d="M12 4L2.5 20h19L12 4z" />
    <path d="M12 10v4M12 17v.5" />
  </Svg>
);

export const ErrorDotIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <circle cx="12" cy="12" r="8" fill="currentColor" />
  </svg>
);

export const FileMissingIcon = () => (
  <Svg>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5M10 12l4 4M14 12l-4 4" />
  </Svg>
);

export const FullscreenIcon = () => (
  <Svg>
    <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />
  </Svg>
);

export const ScanIcon = () => (
  <Svg>
    <rect x="5" y="7" width="14" height="10" rx="1" />
    <path d="M3 4h4M17 4h4M3 20h4M17 20h4" />
  </Svg>
);

export const CopyIcon = () => (
  <Svg>
    <rect x="8" y="8" width="12" height="12" rx="2" />
    <path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" />
  </Svg>
);
