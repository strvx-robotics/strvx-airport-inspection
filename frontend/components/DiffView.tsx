"use client";

import { diffWordsWithSpace, type Change } from "diff";

// Git-style diff of the immutable AI draft vs. the inspector's edited text
// (design §13.3). Monochrome: added words read bright with a dotted underline
// (presence), removed words read faint and struck through (absence).
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
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-[#6b7176]">
          AI draft vs. edited
        </span>
        {!changed && (
          <span className="text-[11px] text-[#9aa1a6]">unedited — matches AI draft</span>
        )}
      </div>
      <pre className="overflow-x-auto whitespace-pre-wrap rounded-md border border-[#dbdfe3] bg-[#f3f5f7] px-3 py-2 font-mono text-xs leading-relaxed text-[#5b6166]">
        {parts.map((part, idx) => {
          if (part.added)
            return (
              <span
                key={idx}
                className="rounded-sm bg-[#eef1f4] text-[#181b1e] underline decoration-dotted underline-offset-2"
              >
                {part.value}
              </span>
            );
          if (part.removed)
            return (
              <span key={idx} className="rounded-sm text-[#9aa1a6] line-through">
                {part.value}
              </span>
            );
          return <span key={idx}>{part.value}</span>;
        })}
      </pre>
      <div className="flex items-center gap-3 font-mono text-[11px] text-[#6b7176]">
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm ring-1 ring-inset ring-[#c7cdd2]" /> removed
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm bg-[#eef1f4] ring-1 ring-inset ring-[#9aa1a6]" /> added
        </span>
      </div>
    </div>
  );
}
