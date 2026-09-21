declare namespace JSX {
  interface IntrinsicElements {
    // App Bridge navigation menu; not part of @shopify/polaris-types.
    "s-app-nav": React.DetailedHTMLProps<
      React.HTMLAttributes<HTMLElement>,
      HTMLElement
    >;
  }
}
