package com.example.checkout;

public class CheckoutController {
    private final CheckoutService service = new CheckoutService();

    public String handle(String orderId) {
        return service.checkout(orderId);
    }
}