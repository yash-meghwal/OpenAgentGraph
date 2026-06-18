package com.example.demo.service

import com.example.demo.repo.OrderRepository

class OrderService(private val repository: OrderRepository) {
    fun load(id: String): String = repository.findById(id)
}