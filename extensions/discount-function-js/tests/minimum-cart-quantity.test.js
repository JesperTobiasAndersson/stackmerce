import { describe, expect, test } from "vitest";

import { cartDeliveryOptionsDiscountsGenerateRun } from "../src/cart_delivery_options_discounts_generate_run";
import { cartLinesDiscountsGenerateRun } from "../src/cart_lines_discounts_generate_run";

describe("minimum cart quantity condition", () => {
  test("does not return product or shipping operations below the minimum", () => {
    const input = discountInput([1, 1]);

    expect(cartLinesDiscountsGenerateRun(input)).toEqual({operations: []});
    expect(cartDeliveryOptionsDiscountsGenerateRun(input)).toEqual({
      operations: [],
    });
  });

  test("returns product and shipping operations at the minimum", () => {
    const input = discountInput([1, 2]);

    expect(cartLinesDiscountsGenerateRun(input).operations).toHaveLength(1);
    expect(cartDeliveryOptionsDiscountsGenerateRun(input).operations).toHaveLength(
      1,
    );
  });
});

function discountInput(quantities) {
  return {
    discount: {
      discountClasses: ["PRODUCT", "SHIPPING"],
      metafield: {
        jsonValue: {
          version: 1,
          id: "campaign-1",
          name: "Minimum quantity discount",
          status: "active",
          productDiscount: {
            type: "percentage",
            percentage: 10,
          },
          shippingDiscount: {
            type: "free_shipping",
          },
          conditions: {
            minimumCartQuantity: 3,
            productIds: [],
            collectionIds: [],
          },
        },
      },
    },
    cart: {
      cost: {
        subtotalAmount: {
          amount: "50.00",
        },
      },
      lines: quantities.map((quantity, index) => ({
        id: `gid://shopify/CartLine/${index + 1}`,
        quantity,
      })),
      deliveryGroups: [
        {
          id: "gid://shopify/CartDeliveryGroup/1",
        },
      ],
    },
  };
}
