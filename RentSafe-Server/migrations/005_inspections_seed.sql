INSERT INTO inspection_templates (version, name, definition, is_active)
VALUES (1, 'Standard Short-let Inspection v1', '{
  "min_photos": 10,
  "max_distance_m": 200,
  "max_accuracy_m": 100,
  "min_duration_minutes": 10,
  "pass_threshold": 70,
  "verification_valid_months": 12,
  "categories": [
    {
      "key": "identity",
      "label": "Property Verification",
      "weight_pct": 20,
      "items": [
        {"key":"identity.exists","label":"Property exists at stated address","weight":10,"require_photo":true},
        {"key":"identity.photos_match","label":"Building matches listing photos","weight":5},
        {"key":"identity.address_sign","label":"Street address or house number visible","weight":5}
      ]
    },
    {
      "key": "safety",
      "label": "Safety",
      "weight_pct": 25,
      "items": [
        {"key":"safety.smoke_detector","label":"Smoke detector present and working","weight":5,"require_photo":true},
        {"key":"safety.fire_extinguisher","label":"Fire extinguisher present","weight":5,"require_photo":true},
        {"key":"safety.exits","label":"Emergency exits accessible","weight":5},
        {"key":"safety.first_aid","label":"First aid kit present","weight":5},
        {"key":"safety.locks","label":"Door locks and window latches working","weight":5}
      ]
    },
    {
      "key": "utilities",
      "label": "Utilities",
      "weight_pct": 20,
      "items": [
        {"key":"utilities.power","label":"Electricity working","weight":5},
        {"key":"utilities.generator","label":"Backup generator working","weight":5,"require_photo":true},
        {"key":"utilities.water","label":"Running water","weight":5},
        {"key":"utilities.hot_water","label":"Hot water working","weight":5}
      ]
    },
    {
      "key": "amenities",
      "label": "Amenities",
      "weight_pct": 20,
      "items": [
        {"key":"amenities.wifi","label":"WiFi working (speed test taken)","weight":5},
        {"key":"amenities.ac","label":"Air conditioning working","weight":5},
        {"key":"amenities.kitchen","label":"Kitchen appliances working","weight":5},
        {"key":"amenities.tv","label":"TV working","weight":5}
      ]
    },
    {
      "key": "cleanliness",
      "label": "Cleanliness",
      "weight_pct": 10,
      "items": [
        {"key":"cleanliness.bedrooms","label":"Bedrooms clean and made","weight":5,"require_photo":true},
        {"key":"cleanliness.bathrooms","label":"Bathrooms clean","weight":5,"require_photo":true}
      ]
    },
    {
      "key": "accuracy",
      "label": "Listing Accuracy",
      "weight_pct": 5,
      "items": [
        {"key":"accuracy.bedrooms","label":"Bedroom count matches listing","weight":2.5},
        {"key":"accuracy.bathrooms","label":"Bathroom count matches listing","weight":2.5}
      ]
    }
  ]
}'::jsonb, TRUE)
ON CONFLICT (version) DO NOTHING;