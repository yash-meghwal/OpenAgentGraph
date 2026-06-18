package com.example.web;

import com.example.api.ApiService;

public class WebController {
    private final ApiService apiService = new ApiService();

    public String handle() {
        return apiService.execute();
    }
}