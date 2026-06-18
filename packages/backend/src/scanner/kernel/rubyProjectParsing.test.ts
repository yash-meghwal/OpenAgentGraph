import { describe, expect, it } from "vitest";
import { parseGemfile, parseGemspec, parseRailsRouteTargets, railsControllerPath } from "./rubyProjectParsing.js";

describe("ruby project parsing", () => {
  it("parses Gemfile gems", () => {
    const gemfile = parseGemfile([
      'source "https://rubygems.org"',
      'gem "rails"',
      'gem "pg", "~> 1.5"',
    ].join("\n"));
    expect(gemfile.gems).toEqual(["pg", "rails"]);
  });

  it("parses gemspec dependencies", () => {
    const gemspec = parseGemspec([
      'Gem::Specification.new do |s|',
      '  s.name = "mygem"',
      '  s.add_runtime_dependency "rake"',
      '  s.add_development_dependency "rspec"',
      '  s.add_dependency "json"',
      'end',
    ].join("\n"));
    expect(gemspec.packageName).toBe("mygem");
    expect(gemspec.dependencies).toEqual(["json", "rake", "rspec"]);
  });

  it("parses static Rails route targets", () => {
    expect(parseRailsRouteTargets([
      "Rails.application.routes.draw do",
      '  resources :users',
      '  get "/profile", to: "users#show"',
      "end",
    ].join("\n"))).toEqual(expect.arrayContaining([
      { controllerName: "users", actionName: "index", resource: "users" },
      { controllerName: "users", actionName: "show", resource: undefined },
    ]));
    expect(parseRailsRouteTargets('get "/profile", to: "users#show"')).toHaveLength(1);
    expect(railsControllerPath("users")).toBe("app/controllers/users_controller.rb");
  });
});