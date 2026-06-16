package com.example.checkout;

import com.example.checkout.model.Order;

public class CheckoutService {
    public String process(Order order) {
        return Order.validate(order) ? "ok" : "invalid";
    }
}