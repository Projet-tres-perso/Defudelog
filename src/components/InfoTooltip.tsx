import React, { useState } from "react";
import { HelpCircle } from "lucide-react";

interface InfoTooltipProps {
  content: string;
  title?: string;
}

export default function InfoTooltip({ content, title }: InfoTooltipProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative inline-flex items-center ml-1 z-20">
      <button
        type="button"
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => setVisible(false)}
        onClick={() => setVisible(!visible)}
        className="text-surface-400 hover:text-primary-400 transition-colors p-0.5 rounded-full focus:outline-none"
        aria-label="Information"
      >
        <HelpCircle size={14} />
      </button>

      {visible && (
        <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 w-64 p-3 bg-surface-900 border border-primary-500/40 rounded-xl shadow-xl text-left z-50 animate-in fade-in zoom-in-95 duration-150">
          {title && <p className="font-semibold text-xs text-primary-300 mb-1">{title}</p>}
          <p className="text-2xs text-surface-200 leading-normal">{content}</p>
          <div className="absolute left-1/2 -translate-x-1/2 top-full w-0 h-0 border-x-6 border-x-transparent border-t-6 border-t-surface-900" />
        </div>
      )}
    </div>
  );
}
