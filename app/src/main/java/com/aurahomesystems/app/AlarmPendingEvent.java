package com.aurahomesystems.app;

import org.json.JSONObject;

import java.util.Map;

final class AlarmPendingEvent {
    final String userKey;
    final String eventTag;
    final long createdAt;
    final String title;
    final String body;

    AlarmPendingEvent(String userKey, String eventTag, long createdAt, String title, String body) {
        this.userKey = userKey != null ? userKey : "";
        this.eventTag = eventTag != null ? eventTag : "";
        this.createdAt = createdAt;
        this.title = title != null && !title.isEmpty() ? title : "Aura HomeSystems";
        this.body = body != null ? body : "";
    }

    static AlarmPendingEvent fromJson(JSONObject json, String fallbackUserKey) {
        return new AlarmPendingEvent(
                json.optString("userKey", fallbackUserKey),
                json.optString("eventTag", ""),
                json.optLong("createdAt", 0L),
                json.optString("title", "Aura HomeSystems"),
                json.optString("body", "Alarm event detected."));
    }

    @SuppressWarnings("unchecked")
    static AlarmPendingEvent fromRtdb(String childKey, Object raw, String fallbackUserKey) {
        if (!(raw instanceof Map)) {
            return null;
        }
        Map<String, Object> map = (Map<String, Object>) raw;
        String eventTag = stringValue(map.get("eventTag"), childKey);
        String userKey = stringValue(map.get("userKey"), fallbackUserKey);
        long createdAt = longValue(map.get("createdAt"));
        String title = stringValue(map.get("title"), "Aura HomeSystems");
        String body = stringValue(map.get("body"), "");
        if (body.isEmpty()) {
            String deviceName = stringValue(map.get("deviceName"), "Sensor");
            String state = stringValue(map.get("state"), "");
            if ("fcm_send_failed".equals(state) || "pending".equals(state)) {
                body = "Alarm event pending delivery.";
            } else {
                body = deviceName + " status update.";
            }
        }
        return new AlarmPendingEvent(userKey, eventTag, createdAt, title, body);
    }

    private static String stringValue(Object value, String fallback) {
        if (value == null) {
            return fallback != null ? fallback : "";
        }
        String s = String.valueOf(value).trim();
        return s.isEmpty() ? (fallback != null ? fallback : "") : s;
    }

    private static long longValue(Object value) {
        if (value instanceof Number) {
            return ((Number) value).longValue();
        }
        if (value instanceof String) {
            try {
                return Long.parseLong((String) value);
            } catch (NumberFormatException ignored) {
                return 0L;
            }
        }
        return 0L;
    }
}
