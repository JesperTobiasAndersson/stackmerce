import {describe, expect, test} from "vitest";

import {cartDeliveryOptionsDiscountsGenerateRun} from "../src/cart_delivery_options_discounts_generate_run";
import {cartLinesDiscountsGenerateRun} from "../src/cart_lines_discounts_generate_run";

describe("fixed amount currency handling", () => {
  test("applies fixed product, order, and shipping amounts when cart currency matches", () => {
    const input = discountInput("DKK");
    const cartLinesResult = cartLinesDiscountsGenerateRun(input);
    const shippingResult = cartDeliveryOptionsDiscountsGenerateRun(input);

    expect(cartLinesResult.operations).toHaveLength(2);
    expect(shippingResult.operations).toHaveLength(1);
    expect(
      cartLinesResult.operations[0].productDiscountsAdd.candidates[0].value
        .percentage.value,
    ).toBe(10);
    expect(
      cartLinesResult.operations[1].orderDiscountsAdd.candidates[0].value
        .percentage.value,
    ).toBe(6);
    expect(
      shippingResult.operations[0].deliveryDiscountsAdd.candidates[0].value
        .fixedAmount.amount,
    ).toBe("25.00");
  });

  test("does not apply fixed product or shipping amounts when cart currency differs", () => {
    const input = discountInput("USD");

    expect(cartLinesDiscountsGenerateRun(input)).toEqual({operations: []});
    expect(cartDeliveryOptionsDiscountsGenerateRun(input)).toEqual({
      operations: [],
    });
  });

  test("uses one fixed order discount candidate across eligible cart lines", () => {
    const input = discountInput("DKK");
    input.cart.lines.push({
      id: "gid://shopify/CartLine/2",
      merchandise: {
        product: {
          id: "gid://shopify/Product/2",
          inAnySelectedCollection: false,
        },
      },
      cost: {
        subtotalAmount: {
          amount: "50.00",
        },
      },
    });

    const candidates =
      cartLinesDiscountsGenerateRun(input).operations[1].orderDiscountsAdd
        .candidates;

    expect(candidates).toHaveLength(1);
    expect(candidates[0].targets).toEqual([
      {
        orderSubtotal: {
          excludedCartLineIds: [],
        },
      },
    ]);
    expect(candidates[0].value.percentage.value).toBeCloseTo(
      (30 / 550) * 100,
    );
  });

  test("splits fixed product amount across eligible cart lines without losing cents", () => {
    const input = discountInput("DKK");
    input.discount.metafield.jsonValue.productDiscount.fixedAmount.amount =
      "50.00";
    input.cart.lines[0].cost.subtotalAmount.amount = "333.33";
    input.cart.lines.push({
      id: "gid://shopify/CartLine/2",
      merchandise: {
        product: {
          id: "gid://shopify/Product/2",
          inAnySelectedCollection: false,
        },
      },
      cost: {
        subtotalAmount: {
          amount: "166.67",
        },
      },
    });

    const candidates =
      cartLinesDiscountsGenerateRun(input).operations[0].productDiscountsAdd
        .candidates;
    const discountCents = candidates.reduce((sum, candidate) => {
      const targetId = candidate.targets[0].cartLine.id;
      const line = input.cart.lines.find((line) => line.id === targetId);
      const lineSubtotalCents = Math.round(
        Number(line.cost.subtotalAmount.amount) * 100,
      );

      return (
        sum +
        Math.round(
          (lineSubtotalCents * candidate.value.percentage.value) / 100,
        )
      );
    }, 0);

    expect(candidates).toHaveLength(2);
    expect(discountCents).toBe(5000);
  });

  test("does not over-adjust fixed amounts for presentment currency rate", () => {
    const input = discountInput("DKK", "0.99995");
    const cartLinesResult = cartLinesDiscountsGenerateRun(input);
    const shippingResult = cartDeliveryOptionsDiscountsGenerateRun(input);

    expect(
      cartLinesResult.operations[0].productDiscountsAdd.candidates[0].value
        .percentage.value,
    ).toBe(10);
    expect(
      cartLinesResult.operations[1].orderDiscountsAdd.candidates[0].value
        .percentage.value,
    ).toBe(6);
    expect(
      shippingResult.operations[0].deliveryDiscountsAdd.candidates[0].value
        .fixedAmount.amount,
    ).toBe("25.00");
  });

  test("excludes ineligible cart lines from fixed order discount targets", () => {
    const input = discountInput("DKK");
    input.discount.metafield.jsonValue.conditions.productIds = [
      "gid://shopify/Product/1",
    ];
    input.cart.lines.push({
      id: "gid://shopify/CartLine/2",
      merchandise: {
        product: {
          id: "gid://shopify/Product/2",
          inAnySelectedCollection: false,
        },
      },
      cost: {
        subtotalAmount: {
          amount: "50.00",
        },
      },
    });

    const target =
      cartLinesDiscountsGenerateRun(input).operations[1].orderDiscountsAdd
        .candidates[0].targets[0];

    expect(target).toEqual({
      orderSubtotal: {
        excludedCartLineIds: ["gid://shopify/CartLine/2"],
      },
    });
  });
});

function discountInput(cartCurrencyCode, presentmentCurrencyRate) {
  return {
    presentmentCurrencyRate,
    discount: {
      discountClasses: ["PRODUCT", "ORDER", "SHIPPING"],
      metafield: {
        jsonValue: {
          version: 1,
          id: "campaign-1",
          name: "Danish market discount",
          status: "active",
          productDiscount: {
            type: "fixed_amount",
            fixedAmount: {
              amount: "50.00",
              currencyCode: "DKK",
            },
          },
          orderDiscount: {
            type: "fixed_amount",
            fixedAmount: {
              amount: "30.00",
              currencyCode: "DKK",
            },
          },
          shippingDiscount: {
            type: "fixed_amount",
            fixedAmount: {
              amount: "25.00",
              currencyCode: "DKK",
            },
          },
          conditions: {
            productIds: [],
            collectionIds: [],
          },
        },
      },
    },
    cart: {
      cost: {
        subtotalAmount: {
          amount: "500.00",
          currencyCode: cartCurrencyCode,
        },
      },
      lines: [
        {
          id: "gid://shopify/CartLine/1",
          merchandise: {
            product: {
              id: "gid://shopify/Product/1",
              inAnySelectedCollection: false,
            },
          },
          cost: {
            subtotalAmount: {
              amount: "500.00",
            },
          },
        },
      ],
      deliveryGroups: [
        {
          id: "gid://shopify/CartDeliveryGroup/1",
        },
      ],
    },
    shop: {
      localTime: {
        date: "2026-04-19",
      },
    },
  };
}
