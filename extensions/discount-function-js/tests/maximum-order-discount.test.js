import { describe, expect, test } from "vitest";

import { cartLinesDiscountsGenerateRun } from "../src/cart_lines_discounts_generate_run";

describe("maximum order discount amount", () => {
  test("caps percentage order discount at the configured maximum amount", () => {
    const result = cartLinesDiscountsGenerateRun(discountInput());

    expect(result.operations).toEqual([
      {
        orderDiscountsAdd: {
          candidates: [
            {
              message: "Capped order discount",
              targets: [
                {
                  orderSubtotal: {
                    excludedCartLineIds: [],
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
          selectionStrategy: "FIRST",
        },
      },
    ]);
  });
});

function discountInput() {
  return {
    discount: {
      discountClasses: ["ORDER"],
      metafield: {
        jsonValue: {
          version: 1,
          id: "campaign-1",
          name: "Capped order discount",
          status: "active",
          productDiscount: {
            type: "none",
          },
          orderDiscount: {
            type: "percentage",
            percentage: 20,
            maximumDiscountAmount: {
              amount: "100.00",
              currencyCode: "USD",
            },
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
      cost: {
        subtotalAmount: {
          amount: "1000.00",
          currencyCode: "USD",
        },
      },
      lines: [
        {
          id: "gid://shopify/CartLine/1",
          cost: {
            subtotalAmount: {
              amount: "1000.00",
            },
          },
        },
      ],
    },
  };
}
