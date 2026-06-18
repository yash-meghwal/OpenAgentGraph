package com.example.demo

import com.example.demo.repo.OrderRepository
import com.example.demo.service.OrderService
import com.example.demo.web.OrderController

fun main() {
    OrderController(OrderService(OrderRepository())).show("demo")
}