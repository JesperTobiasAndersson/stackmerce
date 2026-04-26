import { describe, expect, test } from "vitest";

import { cartLinesDiscountsGenerateRun } from "../src/cart_lines_discounts_generate_run";

describe("collection restriction condition", () => {
  test("only applies product discount to products in selected collections", () => {
    const result = cartLinesDiscountsGenerateRun(discountInput());

    expect(result.operations).toEqual([
      {
        productDiscountsAdd: {
          candidates: [
            {
              message: "Selected collection",
              targets: [
                {
                  cartLine: {
                    id: "gid://shopify/CartLine/1",
                  },
                },
              ],
              value: {
                percentage: {
                  value: 10,
                },
              },
            },
          ],
          selectionStrategy: "ALL",
        },
      },
    ]);
  });

  test("does not apply product discount to excluded collections", () => {
    const input = discountInput();
    input.discount.metafield.jsonValue.conditions.collectionIds = [];
    input.discount.metafield.jsonValue.conditions.excludedCollectionIds = [
      "gid://shopify/Collection/1",
    ];
    input.cart.lines[0].merchandise.product.inAnyExcludedCollection = true;

    expect(cartLinesDiscountsGenerateRun(input).operations).toEqual([
      {
        productDiscountsAdd: {
          candidates: [
            {
              message: "Selected collection",
              targets: [
                {
                  cartLine: {
                    id: "gid://shopify/CartLine/2",
                  },
                },
              ],
              value: {
                percentage: {
                  value: 10,
                },
              },
            },
          ],
          selectionStrategy: "ALL",
        },
      },
    ]);
  });
});

function discountInput() {
  return {
    discount: {
      discountClasses: ["PRODUCT"],
      metafield: {
        jsonValue: {
          version: 1,
          id: "campaign-1",
          name: "Selected collection",
          status: "active",
          productDiscount: {
            type: "percentage",
            percentage: 10,
          },
          shippingDiscount: {
            type: "none",
          },
          conditions: {
            productIds: [],
            collectionIds: ["gid://shopify/Collection/1"],
            excludedProductIds: [],
            excludedCollectionIds: [],
          },
        },
      },
    },
    cart: {
      lines: [
        {
          id: "gid://shopify/CartLine/1",
          merchandise: {
            product: {
              id: "gid://shopify/Product/1",
              inAnySelectedCollection: true,
            },
          },
        },
        {
          id: "gid://shopify/CartLine/2",
          merchandise: {
            product: {
              id: "gid://shopify/Product/2",
              inAnySelectedCollection: false,
            },
          },
        },
      ],
    },
  };
}
