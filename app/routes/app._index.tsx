import { Link } from "react-router";

import styles from "./app._index/styles.module.css";

const launchItems = [
  {
    eyebrow: "Step 1",
    title: "Create your first discount",
    description:
      "Build automatic product, order, or shipping discounts with targeting, scheduling, and clear campaign controls.",
    href: "/app/campaigns/new",
    cta: "Create discount",
  },
  {
    eyebrow: "Step 2",
    title: "Review your active campaigns",
    description:
      "See which discounts are live, what is still in draft, and how much campaign capacity your current plan includes.",
    href: "/app/campaigns",
    cta: "Open discounts",
  },
  {
    eyebrow: "Step 3",
    title: "Choose the right plan",
    description:
      "Upgrade when you need shipping discounts, volume tiers, market targeting, or more active campaigns.",
    href: "/app/plans",
    cta: "View plans",
  },
];

const capabilityItems = [
  "Automatic product, order, and shipping discounts",
  "Market targeting, schedules, and minimum cart rules",
  "Fast embedded workflow directly in Shopify Admin",
];

export default function AppIndex() {
  return (
    <s-page heading="Overview">
      <s-section>
        <div className={styles.hero}>
          <div className={styles.heroContent}>
            <span className={styles.eyebrow}>Discount operations</span>
            <h1 className={styles.title}>Launch campaigns without leaving Shopify Admin</h1>
            <p className={styles.description}>
              Set up your first automatic discount, keep campaign control in one
              place, and expand into more advanced discount logic when the store
              needs it.
            </p>
            <div className={styles.actions}>
              <Link className={styles.primaryAction} to="/app/campaigns/new">
                Create your first discount
              </Link>
              <Link className={styles.secondaryAction} to="/app/campaigns">
                Browse discounts
              </Link>
            </div>
          </div>

          <aside className={styles.heroPanel}>
            <span className={styles.panelEyebrow}>What you can do here</span>
            <ul className={styles.capabilityList}>
              {capabilityItems.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </aside>
        </div>
      </s-section>

      <s-section>
        <div className={styles.grid}>
          {launchItems.map((item) => (
            <article className={styles.card} key={item.title}>
              <span className={styles.cardEyebrow}>{item.eyebrow}</span>
              <h2 className={styles.cardTitle}>{item.title}</h2>
              <p className={styles.cardDescription}>{item.description}</p>
              <Link className={styles.cardLink} to={item.href}>
                {item.cta}
              </Link>
            </article>
          ))}
        </div>
      </s-section>
    </s-page>
  );
}
