// Small helper for formatting device UUIDs.
pub fn format_uuid(raw: &str) -> String {
    raw.trim().to_lowercase()
}

pub fn is_valid(uuid: &str) -> bool {
    uuid.len() == 36 && uuid.chars().filter(|c| *c == '-').count() == 4
}
