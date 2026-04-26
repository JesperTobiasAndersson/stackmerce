import { describe, expect, test } from "vitest";

import { cartDeliveryOptionsDiscountsGenerateRun } from "../src/cart_delivery_options_discounts_generate_run";
import { cartLinesDiscountsGenerateRun } from "../src/cart_lines_discounts_generate_run";

describe("minimum cart subtotal condition", () => {
  test("does not return product or shipping operations below the minimum", () => {
    const input = discountInput("49.99");

    expect(cartLinesDiscountsGenerateRun(input)).toEqual({operations: []});
    expect(cartDeliveryOptionsDiscountsGenerateRun(input)).toEqual({
      operations: [],
    });
  });

  test("returns product and shipping operations at the minimum", () => {
    const input = discountInput("50.00");

    expect(cartLinesDiscountsGenerateRun(input).operations).toHaveLength(1);
    expect(cartDeliveryOptionsDiscountsGenerateRun(input).operations).toHaveLength(
      1,
    );
  });
});

function discountInput(cartSubtotal) {
  return {
    discount: {
      discountClasses: ["PRODUCT", "SHIPPING"],
      metafield: {
        jsonValue: {
          version: 1,
          id: "campaign-1",
          name: "Minimum subtotal discount",
          status: "active",
          productDiscount: {
            type: "percentage",
            percentage: 10,
          },
          shippingDiscount: {
            type: "free_shipping",
          },
          conditions: {
            minimumCartSubtotal: {
              amount: "50.00",
              currencyCode: "USD",
            },
            productIds: [],
            collectionIds: [],
          },
        },
      },
    },
    cart: {
      cost: {
        subtotalAmount: {
          amount: cartSubtotal,
        },
      },
      lines: [
        {
          id: "gid://shopify/CartLine/1",
        },
      ],
      deliveryGroups: [
        {
          id: "gid://shopify/CartDeliveryGroup/1",
        },
      ],
    },
  };
}
