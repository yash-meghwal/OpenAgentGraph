package com.example.checkout;

import org.junit.jupiter.api.Test;

public class CheckoutServiceTest {
    @Test
    public void checksOutOrder() {
        CheckoutService service = new CheckoutService();
        service.checkout("order-1");
    }
}