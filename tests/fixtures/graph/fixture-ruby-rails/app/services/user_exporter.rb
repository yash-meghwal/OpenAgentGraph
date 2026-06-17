class UserExporter
  def export(users)
    users.map(&:full_name)
  end
end