"use client";

import { diffWordsWithSpace, type Change } from "diff";

// Git-style diff of the immutable AI draft vs. the inspector's edited text
// (design §13.3). Removed words from the AI draft render red/struck-through,
// added words render emerald — reusing the existing color tokens.
export default function DiffView({
  aiDraftText,
  editedText,
}: {
  aiDraftText: string;
  editedText: string;
}) {
  const parts: Change[] = diffWordsWithSpace(aiDraftText, editedText);
  const changed = parts.some((p) => p.added || p.removed);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-[#737a7f]">
          AI draft vs. edited
        </span>
        {!changed && (
          <span className="text-[11px] text-[#5b6166]">unedited — matches AI draft</span>
        )}
      </div>
      <pre className="overflow-x-auto whitespace-pre-wrap rounded-md border border-[#262b2f] bg-[#0f1214] px-3 py-2 font-mono text-xs leading-relaxed text-[#9aa1a6]">
        {parts.map((part, idx) => {
          if (part.added)
            return (
              <span key={idx} className="rounded-sm bg-[#0f2419] text-[#56c98a]">
                {part.value}
              </span>
            );
          if (part.removed)
            return (
              <span
                key={idx}
                className="rounded-sm bg-[#2a1311] text-[#e2685c] line-through"
              >
                {part.value}
              </span>
            );
          return <span key={idx}>{part.value}</span>;
        })}
      </pre>
      <div className="flex items-center gap-3 font-mono text-[11px] text-[#737a7f]">
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm bg-[#2a1311] ring-1 ring-inset ring-[#5c2420]" /> removed
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm bg-[#0f2419] ring-1 ring-inset ring-[#1f4631]" /> added
        </span>
      </div>
    </div>
  );
}
