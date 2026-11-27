import Link from "next/link";
import { LuArrowUpRight } from "react-icons/lu";
import { PixelMark } from "./PixelMark";

const rows = [
  ["Changed code", "Security findings", "Caller context"],
  ["Confidence scores", "Repository rules", "Suggested fixes"],
  ["Review evidence", "Your decision", "Ready to merge"],
];

export function ReviewCTA() {
  return (
    <section className="review-cta" aria-labelledby="review-cta-heading">
      <span className="pixel-eyebrow">THE FULL PICTURE. A CLEARER CALL.</span>
      <h2 id="review-cta-heading">Your code. Your context. Your call.</h2>
      <div className="review-cta-network">
        <svg
          className="review-cta-threads"
          viewBox="0 0 1200 330"
          preserveAspectRatio="none"
          fill="none"
          aria-hidden="true"
        >
          <path d="M0 5 1200 280M0 95 1200 200M0 325 1200 10M0 235 1200 80M0 165 1200 320M0 305 1200 140" />
        </svg>
        <ul
          className="review-cta-nodes"
          aria-label="A connected review workflow"
        >
          {rows.map((row, rowIndex) => (
            <li className="review-cta-row" key={row[0]}>
              {row.map((label, index) => (
                <span
                  className={`review-cta-node ${index === 1 ? "is-highlighted" : ""}`}
                  key={label}
                >
                  {index === 1 &&
                    (rowIndex === 2 ? (
                      <PixelMark />
                    ) : (
                      <PixelReviewIcon kind={rowIndex} />
                    ))}
                  {label}
                </span>
              ))}
            </li>
          ))}
        </ul>
      </div>
      <div className="review-cta-action">
        <p>Connect a repository or explore a recorded review.</p>
        <Link className="primary-link" href="/login">
          Start your review <LuArrowUpRight size={16} />
        </Link>
      </div>
    </section>
  );
}

function PixelReviewIcon({ kind }: { kind: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      {kind === 0 ? (
        <path
          fillRule="evenodd"
          d="M10 2h4v2h6v10h-2v4h-2v2h-2v2h-4v-2H8v-2H6v-4H4V4h6V2Zm0 4H6v8h2v4h2v2h4v-2h2v-4h2V6h-4V4h-4v2Zm4 3h2v4h-2v2h-4v-2H8v-2h2v2h2v-2h2V9Z"
        />
      ) : (
        <path
          fillRule="evenodd"
          d="M4 2h12v2h2v2h2v16H4V2Zm2 2v16h12V8h-4V4H6Zm10 2h2v2h-2V6ZM8 10h6v2H8v-2Zm0 4h8v2H8v-2Zm0 4h6v2H8v-2Z"
        />
      )}
    </svg>
  );
}
