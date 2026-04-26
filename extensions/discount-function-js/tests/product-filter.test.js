import { describe, expect, test } from "vitest";

import { cartLinesDiscountsGenerateRun } from "../src/cart_lines_discounts_generate_run";

describe("product restriction condition", () => {
  test("only applies product discount to selected products", () => {
    const result = cartLinesDiscountsGenerateRun(discountInput());

    expect(result.operations).toEqual([
      {
        productDiscountsAdd: {
          candidates: [
            {
              message: "Selected products",
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

  test("does not apply product discount to excluded products", () => {
    const input = discountInput();
    input.discount.metafield.jsonValue.conditions.productIds = [];
    input.discount.metafield.jsonValue.conditions.excludedProductIds = [
      "gid://shopify/Product/1",
    ];

    expect(cartLinesDiscountsGenerateRun(input).operations).toEqual([
      {
        productDiscountsAdd: {
          candidates: [
            {
              message: "Selected products",
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
          name: "Selected products",
          status: "active",
          productDiscount: {
            type: "percentage",
            percentage: 10,
          },
          shippingDiscount: {
            type: "none",
          },
          conditions: {
            productIds: ["gid://shopify/Product/1"],
            collectionIds: [],
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
            },
          },
        },
        {
          id: "gid://shopify/CartLine/2",
          merchandise: {
            product: {
              id: "gid://shopify/Product/2",
            },
          },
        },
      ],
    },
  };
}
