import type { JSX } from "react";

/** The currency union Polaris money fields accept. */
export type CurrencyCode = NonNullable<
  JSX.IntrinsicElements["s-money-field"]["currencyCode"]
>;

/**
 * Helpers for rendering Polaris web components from React 18.
 *
 * React 18 writes props on custom elements as string attributes, so
 * `disabled={false}` becomes `disabled="false"`, which a boolean HTML
 * attribute reads as *true*. Pass booleans through `flag()` so a false value
 * omits the attribute entirely.
 */
export function flag(value: boolean | null | undefined): true | undefined {
  return value ? true : undefined;
}

/** Reads the value from a change/input event fired by a Polaris field. */
export function fieldValue(event: Event): string {
  const target = event.target as { value?: string | number | null } | null;

  return target?.value == null ? "" : String(target.value);
}

/** Reads the checked state from a change event fired by a Polaris checkbox/switch. */
export function fieldChecked(event: Event): boolean {
  return Boolean((event.target as { checked?: boolean } | null)?.checked);
}

/** Shows an App Bridge toast when running inside Shopify Admin. */
export function showToast(message: string, options: { isError?: boolean } = {}) {
  if (typeof shopify === "undefined" || !shopify?.toast) {
    return;
  }

  shopify.toast.show(message, options);
}
