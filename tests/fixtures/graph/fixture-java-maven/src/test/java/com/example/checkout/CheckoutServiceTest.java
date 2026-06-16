package com.example.checkout;

import com.example.checkout.model.Order;
import org.junit.jupiter.api.Test;

public class CheckoutServiceTest {
    @Test
    public void processesValidOrder() {
        CheckoutService service = new CheckoutService();
        service.process(new Order("order-1"));
    }
}