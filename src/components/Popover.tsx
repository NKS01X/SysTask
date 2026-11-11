import { useEffect, useRef, useState, type ReactNode } from "react";

export default function Popover({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div className="popover" ref={ref}>
      <button className="ghost" onClick={() => setOpen(!open)}>
        {label} ▾
      </button>
      {open && <div className="popover-body">{children}</div>}
    </div>
  );
}
