package com.example.checkout.model;

public class Order {
    private final String id;

    public Order(String id) {
        this.id = id;
    }

    public static boolean validate(Order order) {
        return order != null && order.id != null && !order.id.isBlank();
    }
}