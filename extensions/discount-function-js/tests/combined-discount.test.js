import { describe, expect, test } from "vitest";

import { cartDeliveryOptionsDiscountsGenerateRun } from "../src/cart_delivery_options_discounts_generate_run";
import { cartLinesDiscountsGenerateRun } from "../src/cart_lines_discounts_generate_run";

describe("combined product and shipping discount", () => {
  test("returns product and shipping operations from the same campaign config", () => {
    const input = combinedDiscountInput();

    const productResult = cartLinesDiscountsGenerateRun(input);
    const shippingResult = cartDeliveryOptionsDiscountsGenerateRun(input);

    expect(productResult.operations).toEqual([
      {
        productDiscountsAdd: {
          candidates: [
            {
              message: "Combined discount",
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

    expect(shippingResult.operations).toEqual([
      {
        deliveryDiscountsAdd: {
          candidates: [
            {
              message: "Combined discount",
              targets: [
                {
                  deliveryGroup: {
                    id: "gid://shopify/CartDeliveryGroup/1",
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

  test("targets a selected shipping method when configured", () => {
    const input = combinedDiscountInput();
    input.discount.metafield.jsonValue.shippingDiscount.deliveryOptionHandles = [
      "express-shipping",
    ];
    input.cart.deliveryGroups[0].deliveryOptions = [
      {
        handle: "standard-shipping",
        title: "Standard Shipping",
        code: "standard",
      },
      {
        handle: "express-shipping",
        title: "Express Shipping",
        code: "express",
      },
    ];

    expect(cartDeliveryOptionsDiscountsGenerateRun(input).operations).toEqual([
      {
        deliveryDiscountsAdd: {
          candidates: [
            {
              message: "Combined discount",
              targets: [
                {
                  deliveryOption: {
                    handle: "express-shipping",
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

  test("returns no shipping operations when the selected market does not match", () => {
    const input = combinedDiscountInput();
    input.localization.market.handle = "sweden";
    input.discount.metafield.jsonValue.conditions.marketHandles = ["denmark"];

    expect(cartDeliveryOptionsDiscountsGenerateRun(input).operations).toEqual([]);
    expect(cartLinesDiscountsGenerateRun(input).operations).toEqual([]);
  });

  test("returns product and shipping operations when the selected market matches", () => {
    const input = combinedDiscountInput();
    input.localization.market.handle = "sweden";
    input.discount.metafield.jsonValue.conditions.marketHandles = ["sweden"];

    expect(cartLinesDiscountsGenerateRun(input).operations).toHaveLength(1);

    expect(cartDeliveryOptionsDiscountsGenerateRun(input).operations).toEqual([
      {
        deliveryDiscountsAdd: {
          candidates: [
            {
              message: "Combined discount",
              targets: [
                {
                  deliveryGroup: {
                    id: "gid://shopify/CartDeliveryGroup/1",
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

function combinedDiscountInput() {
  return {
    localization: {
      market: {
        handle: "primary",
      },
    },
    discount: {
      discountClasses: ["PRODUCT", "SHIPPING"],
      metafield: {
        jsonValue: {
          version: 1,
          id: "campaign-1",
          name: "Combined discount",
          status: "active",
          productDiscount: {
            type: "percentage",
            percentage: 10,
          },
          shippingDiscount: {
            type: "free_shipping",
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
      lines: [
        {
          id: "gid://shopify/CartLine/1",
        },
      ],
      deliveryGroups: [
        {
          id: "gid://shopify/CartDeliveryGroup/1",
          deliveryOptions: [],
        },
      ],
    },
  };
}
