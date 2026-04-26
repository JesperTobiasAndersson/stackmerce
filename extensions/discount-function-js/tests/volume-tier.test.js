import { describe, expect, test } from "vitest";

import { cartLinesDiscountsGenerateRun } from "../src/cart_lines_discounts_generate_run";

describe("volume tier product discount", () => {
  test("does not discount below the first matching tier", () => {
    const input = discountInput([1, 1]);

    expect(cartLinesDiscountsGenerateRun(input)).toEqual({operations: []});
  });

  test("applies the highest matching tier to eligible lines", () => {
    const input = discountInput([2, 3]);

    expect(cartLinesDiscountsGenerateRun(input).operations).toEqual([
      {
        productDiscountsAdd: {
          candidates: [
            {
              message: "Volume tiers",
              targets: [
                {
                  cartLine: {
                    id: "gid://shopify/CartLine/1",
                  },
                },
                {
                  cartLine: {
                    id: "gid://shopify/CartLine/2",
                  },
                },
              ],
              value: {
                percentage: {
                  value: 20,
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

function discountInput(quantities) {
  return {
    discount: {
      discountClasses: ["PRODUCT"],
      metafield: {
        jsonValue: {
          version: 1,
          id: "campaign-1",
          name: "Volume tiers",
          status: "active",
          productDiscount: {
            type: "volume_tier",
            volumeTiers: [
              {
                minimumQuantity: 3,
                percentage: 10,
              },
              {
                minimumQuantity: 5,
                percentage: 20,
              },
            ],
          },
          shippingDiscount: {
            type: "none",
          },
          conditions: {
            productIds: [],
            collectionIds: [],
            excludedProductIds: [],
            excludedCollectionIds: [],
          },
        },
      },
    },
    cart: {
      lines: quantities.map((quantity, index) => ({
        id: `gid://shopify/CartLine/${index + 1}`,
        quantity,
      })),
    },
  };
}
