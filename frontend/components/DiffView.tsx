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
        <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          AI draft vs. edited
        </span>
        {!changed && (
          <span className="text-xs text-zinc-400">unedited — matches AI draft</span>
        )}
      </div>
      <pre className="overflow-x-auto whitespace-pre-wrap rounded-md border border-zinc-200 bg-white px-3 py-2 font-mono text-xs leading-relaxed text-zinc-700">
        {parts.map((part, idx) => {
          if (part.added)
            return (
              <span
                key={idx}
                className="rounded-sm bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20"
              >
                {part.value}
              </span>
            );
          if (part.removed)
            return (
              <span
                key={idx}
                className="rounded-sm bg-red-50 text-red-700 line-through ring-1 ring-inset ring-red-600/20"
              >
                {part.value}
              </span>
            );
          return <span key={idx}>{part.value}</span>;
        })}
      </pre>
      <div className="flex items-center gap-3 text-xs text-zinc-400">
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm bg-red-200" /> removed
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm bg-emerald-200" /> added
        </span>
      </div>
    </div>
  );
}
