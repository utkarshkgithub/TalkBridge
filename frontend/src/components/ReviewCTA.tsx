import Link from "next/link";
import { PixelIcon } from "./PixelIcon";
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
                      <PixelIcon name={rowIndex === 0 ? "shield" : "file"} />
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
          Start your review <PixelIcon name="arrowUpRight" size={16} />
        </Link>
      </div>
    </section>
  );
}
