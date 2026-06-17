require "rails_helper"

RSpec.describe User do
  it "builds a full name" do
    user = User.new(first_name: "Ada", last_name: "Lovelace")
    expect(user.full_name).to eq("Ada Lovelace")
  end
end