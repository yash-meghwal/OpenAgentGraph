package com.example.api;

import com.example.core.BaseService;
import com.example.core.CoreRepository;

public class ApiService extends BaseService {
    private final CoreRepository repository = new CoreRepository();

    public String execute() {
        return repository.load("payload");
    }
}