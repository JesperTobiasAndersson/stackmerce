import { Link } from "react-router";

import styles from "./app._index/styles.module.css";

const overviewItems = [
  {
    label: "Discount types",
    value: "3",
    description: "Product, order, and shipping campaigns in one workflow.",
  },
  {
    label: "Control areas",
    value: "5+",
    description: "Schedules, targeting, minimums, markets, and combinations.",
  },
  {
    label: "Admin flow",
    value: "1",
    description: "Everything stays embedded directly inside Shopify Admin.",
  },
];

const launchItems = [
  {
    eyebrow: "Create",
    title: "Build your first campaign",
    description:
      "Start with an automatic discount and configure product, order, or shipping logic from one editor.",
    href: "/app/campaigns/new",
    cta: "Create discount",
  },
  {
    eyebrow: "Manage",
    title: "Keep active campaigns under control",
    description:
      "Review what is live, what is still in draft, and how your current plan affects campaign capacity.",
    href: "/app/campaigns",
    cta: "Open discounts",
  },
  {
    eyebrow: "Scale",
    title: "Expand features when you need them",
    description:
      "Upgrade when the store needs shipping discounts, volume tiers, market targeting, or more active campaigns.",
    href: "/app/plans",
    cta: "View plans",
  },
];

export default function AppIndex() {
  return (
    <s-page heading="Overview">
      <s-section>
        <div className={styles.header}>
          <div>
            <span className={styles.eyebrow}>Discount operations</span>
            <h1 className={styles.title}>Start building campaigns inside Shopify Admin</h1>
            <p className={styles.description}>
              This app keeps discount creation, campaign management, and plan
              controls in the same workflow you already use for your store.
            </p>
          </div>
          <div className={styles.headerActions}>
            <Link className={styles.primaryAction} to="/app/campaigns/new">
              Create discount
            </Link>
            <Link className={styles.secondaryAction} to="/app/campaigns">
              Browse discounts
            </Link>
          </div>
        </div>
      </s-section>

      <s-section>
        <div className={styles.summaryGrid} aria-label="Overview summary">
          {overviewItems.map((item) => (
            <div className={styles.summaryCard} key={item.label}>
              <span className={styles.summaryLabel}>{item.label}</span>
              <strong className={styles.summaryValue}>{item.value}</strong>
              <span className={styles.summaryText}>{item.description}</span>
            </div>
          ))}
        </div>
      </s-section>

      <s-section>
        <div className={styles.cardGrid}>
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
