package com.example.demo.service

import com.example.demo.repo.OrderRepository
import org.junit.jupiter.api.Test

class OrderServiceTest {
    @Test
    fun loadsOrder() {
        OrderService(OrderRepository()).load("order-1")
    }
}