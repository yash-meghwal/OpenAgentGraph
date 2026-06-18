package com.example.checkout;

public class CheckoutService {
    private final CheckoutRepository repository = new CheckoutRepository();

    public String checkout(String orderId) {
        return repository.findOrder(orderId);
    }
}