import { describe, expect, test } from "vitest";

import { cartDeliveryOptionsDiscountsGenerateRun } from "../src/cart_delivery_options_discounts_generate_run";
import { cartLinesDiscountsGenerateRun } from "../src/cart_lines_discounts_generate_run";

describe("date range condition", () => {
  test("does not return product or shipping operations before the start date", () => {
    const input = discountInput("2026-04-17");

    expect(cartLinesDiscountsGenerateRun(input)).toEqual({operations: []});
    expect(cartDeliveryOptionsDiscountsGenerateRun(input)).toEqual({
      operations: [],
    });
  });

  test("returns product and shipping operations inside the date range", () => {
    const input = discountInput("2026-04-18");

    expect(cartLinesDiscountsGenerateRun(input).operations).toHaveLength(1);
    expect(cartDeliveryOptionsDiscountsGenerateRun(input).operations).toHaveLength(
      1,
    );
  });

  test("does not return product or shipping operations after the end date", () => {
    const input = discountInput("2026-04-20");

    expect(cartLinesDiscountsGenerateRun(input)).toEqual({operations: []});
    expect(cartDeliveryOptionsDiscountsGenerateRun(input)).toEqual({
      operations: [],
    });
  });
});

function discountInput(currentDate) {
  return {
    discount: {
      discountClasses: ["PRODUCT", "SHIPPING"],
      metafield: {
        jsonValue: {
          version: 1,
          id: "campaign-1",
          name: "Date range discount",
          status: "active",
          productDiscount: {
            type: "percentage",
            percentage: 10,
          },
          shippingDiscount: {
            type: "free_shipping",
          },
          conditions: {
            startsAt: "2026-04-18",
            endsAt: "2026-04-19",
            productIds: [],
            collectionIds: [],
          },
        },
      },
    },
    shop: {
      localTime: {
        date: currentDate,
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
        },
      ],
    },
  };
}
