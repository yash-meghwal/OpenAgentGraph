Rails.application.routes.draw do
  resources :users
  get "/profile", to: "users#show"
end