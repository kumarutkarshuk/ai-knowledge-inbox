import { createContext, useContext, type ComponentProps } from "react";
import Markdown, { type Components } from "react-markdown";
import { isNotFound, type Answer } from "@/lib/answer";
import { citationNumber, remarkCitations } from "@/lib/citations";

const MARKDOWN_CLASS =
  "max-w-[65ch] text-[1.0625rem] leading-[1.7] [&_a]:text-brick [&_code]:bg-well [&_code]:px-1 [&_code]:font-mono [&_code]:text-[0.875em] [&_h1]:mt-6 [&_h1]:mb-2 [&_h1]:text-xl [&_h2]:mt-6 [&_h2]:mb-2 [&_h2]:text-lg [&_h3]:mt-4 [&_h3]:mb-1 [&_h3]:text-base [&_li]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-3 [&_p:first-child]:mt-0 [&_pre]:overflow-x-auto [&_pre]:border-y [&_pre]:border-hairline [&_pre]:bg-well [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_ul]:list-disc [&_ul]:pl-5";

const CiteContext = createContext<(n: number) => void>(() => undefined);

function MarkdownLink({ href, children }: ComponentProps<"a">) {
  const onCite = useContext(CiteContext);
  const n = citationNumber(href);
  if (n === null) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="underline decoration-1 underline-offset-[0.16em] hover:decoration-2"
      >
        {children}
      </a>
    );
  }
  return (
    <button
      type="button"
      aria-label={`Citation ${n}`}
      onClick={() => onCite(n)}
      className="mx-0.5 inline-flex h-5 min-w-5 items-center justify-center bg-well px-1 align-text-top font-figure text-xs text-brick tabular-nums transition-[color,background-color] duration-(--dur-micro) hover:bg-brick hover:text-background"
    >
      {n}
    </button>
  );
}

const COMPONENTS: Components = { a: MarkdownLink };

export function AnswerView({ answer, onCite }: { answer: Answer; onCite: (n: number) => void }) {
  return (
    <div className="flex flex-col gap-4">
      {answer.status === "loading" && (
        <p role="status" className="text-sm text-muted-foreground">
          {answer.citations ? "Writing the answer..." : "Searching your saved items..."}
        </p>
      )}
      {isNotFound(answer) ? (
        <p className="text-[1.0625rem] text-muted-foreground italic">{answer.text}</p>
      ) : (
        answer.text && (
          <div data-testid="answer" className={MARKDOWN_CLASS}>
            <CiteContext value={onCite}>
              <Markdown
                components={COMPONENTS}
                remarkPlugins={[remarkCitations(answer.citations?.length ?? 0)]}
                disallowedElements={["img"]}
              >
                {answer.text}
              </Markdown>
            </CiteContext>
          </div>
        )
      )}
      {answer.error && (
        <p role="alert" className="text-sm text-destructive">
          {answer.error}
        </p>
      )}
    </div>
  );
}
