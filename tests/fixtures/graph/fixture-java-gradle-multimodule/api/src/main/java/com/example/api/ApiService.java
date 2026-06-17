package com.example.api;

import com.example.core.CoreService;

public class ApiService {
    private final CoreService coreService = new CoreService();

    public String run() {
        return coreService.execute();
    }
}