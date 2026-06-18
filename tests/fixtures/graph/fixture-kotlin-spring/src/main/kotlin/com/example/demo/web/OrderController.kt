package com.example.demo.web

import com.example.demo.service.OrderService

class OrderController(private val service: OrderService) {
    fun show(id: String): String = service.load(id)
}