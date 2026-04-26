import { describe, expect, test } from "vitest";

import { cartLinesDiscountsGenerateRun } from "../src/cart_lines_discounts_generate_run";

describe("buy one get one free product discount", () => {
  test("discounts the cheapest eligible items first", () => {
    const result = cartLinesDiscountsGenerateRun(discountInput());

    expect(result.operations).toEqual([
      {
        productDiscountsAdd: {
          candidates: [
            {
              message: "BOGO",
              targets: [
                {
                  cartLine: {
                    id: "gid://shopify/CartLine/cheap",
                    quantity: 1,
                  },
                },
              ],
              value: {
                percentage: {
                  value: 100,
                },
              },
            },
            {
              message: "BOGO",
              targets: [
                {
                  cartLine: {
                    id: "gid://shopify/CartLine/mid",
                    quantity: 1,
                  },
                },
              ],
              value: {
                percentage: {
                  value: 100,
                },
              },
            },
          ],
          selectionStrategy: "ALL",
        },
      },
    ]);
  });

  test("supports configurable buy x get y quantities", () => {
    const input = discountInput();
    input.discount.metafield.jsonValue.productDiscount.buyQuantity = 2;
    input.discount.metafield.jsonValue.productDiscount.freeQuantity = 1;

    expect(cartLinesDiscountsGenerateRun(input).operations).toEqual([
      {
        productDiscountsAdd: {
          candidates: [
            {
              message: "BOGO",
              targets: [
                {
                  cartLine: {
                    id: "gid://shopify/CartLine/cheap",
                    quantity: 1,
                  },
                },
              ],
              value: {
                percentage: {
                  value: 100,
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
          name: "BOGO",
          status: "active",
          productDiscount: {
            type: "buy_one_get_one_free",
          },
          shippingDiscount: {
            type: "none",
          },
          conditions: {
            productIds: [],
            collectionIds: [],
          },
        },
      },
    },
    cart: {
      lines: [
        {
          id: "gid://shopify/CartLine/expensive",
          quantity: 1,
          cost: {
            subtotalAmount: {
              amount: "100.00",
            },
          },
        },
        {
          id: "gid://shopify/CartLine/cheap",
          quantity: 1,
          cost: {
            subtotalAmount: {
              amount: "30.00",
            },
          },
        },
        {
          id: "gid://shopify/CartLine/mid",
          quantity: 2,
          cost: {
            subtotalAmount: {
              amount: "100.00",
            },
          },
        },
        {
          id: "gid://shopify/CartLine/free-missing-cost",
          quantity: 2,
        },
      ],
    },
    shop: {
      localTime: {
        date: "2026-04-21",
      },
    },
  };
}
