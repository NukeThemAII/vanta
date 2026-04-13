export const SCHEMA_STATEMENTS: readonly string[] = [
  `
    CREATE TABLE IF NOT EXISTS app_boots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      boot_id TEXT NOT NULL UNIQUE,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      status TEXT NOT NULL,
      app_env TEXT NOT NULL,
      network TEXT NOT NULL,
      markets_json TEXT NOT NULL,
      operator_address TEXT,
      bootstrap_summary_json TEXT,
      error_message TEXT,
      stop_reason TEXT
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS app_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      boot_id TEXT NOT NULL,
      event_time TEXT NOT NULL,
      event_type TEXT NOT NULL,
      severity TEXT NOT NULL,
      component TEXT NOT NULL,
      message TEXT NOT NULL,
      payload_json TEXT
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS market_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      boot_id TEXT NOT NULL,
      received_at TEXT NOT NULL,
      exchange_timestamp_ms INTEGER,
      market TEXT NOT NULL,
      channel TEXT NOT NULL,
      payload_json TEXT NOT NULL
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS asset_registry_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      boot_id TEXT,
      created_at TEXT NOT NULL,
      network TEXT NOT NULL,
      snapshot_json TEXT NOT NULL
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS asset_registry_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_id INTEGER NOT NULL,
      asset_kind TEXT NOT NULL,
      asset_id INTEGER NOT NULL,
      symbol TEXT NOT NULL,
      display_name TEXT NOT NULL,
      size_decimals INTEGER NOT NULL,
      price_max_decimals INTEGER NOT NULL,
      base_symbol TEXT,
      quote_symbol TEXT,
      token_index INTEGER,
      pair_index INTEGER,
      raw_json TEXT NOT NULL,
      FOREIGN KEY (snapshot_id) REFERENCES asset_registry_snapshots(id) ON DELETE CASCADE
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS account_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      boot_id TEXT,
      created_at TEXT NOT NULL,
      source TEXT NOT NULL,
      operator_address TEXT NOT NULL,
      network TEXT NOT NULL,
      snapshot_json TEXT NOT NULL
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS position_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_snapshot_id INTEGER NOT NULL,
      asset_id INTEGER NOT NULL,
      market_symbol TEXT NOT NULL,
      direction TEXT NOT NULL,
      size TEXT NOT NULL,
      leverage_type TEXT NOT NULL,
      leverage_value REAL NOT NULL,
      status_json TEXT NOT NULL,
      FOREIGN KEY (account_snapshot_id) REFERENCES account_snapshots(id) ON DELETE CASCADE
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS balance_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_snapshot_id INTEGER NOT NULL,
      token_index INTEGER NOT NULL,
      coin TEXT NOT NULL,
      total TEXT NOT NULL,
      hold TEXT NOT NULL,
      entry_ntl TEXT NOT NULL,
      FOREIGN KEY (account_snapshot_id) REFERENCES account_snapshots(id) ON DELETE CASCADE
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS open_order_snapshot_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      boot_id TEXT,
      created_at TEXT NOT NULL,
      source TEXT NOT NULL,
      operator_address TEXT NOT NULL,
      network TEXT NOT NULL,
      snapshot_json TEXT NOT NULL
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS open_order_snapshot_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_run_id INTEGER NOT NULL,
      order_id INTEGER NOT NULL,
      client_order_id TEXT,
      market_symbol TEXT NOT NULL,
      asset_id INTEGER NOT NULL,
      market_type TEXT NOT NULL,
      side TEXT NOT NULL,
      limit_price TEXT NOT NULL,
      size TEXT NOT NULL,
      original_size TEXT NOT NULL,
      status TEXT NOT NULL,
      status_timestamp_ms INTEGER NOT NULL,
      placed_timestamp_ms INTEGER NOT NULL,
      raw_json TEXT NOT NULL,
      FOREIGN KEY (snapshot_run_id) REFERENCES open_order_snapshot_runs(id) ON DELETE CASCADE
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS reconciliation_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      boot_id TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      trigger TEXT NOT NULL,
      status TEXT NOT NULL,
      operator_address TEXT,
      trust_state_before TEXT NOT NULL,
      trust_state_after TEXT,
      issue_count INTEGER NOT NULL DEFAULT 0,
      summary_json TEXT,
      error_message TEXT
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS reconciliation_issues (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL,
      severity TEXT NOT NULL,
      issue_type TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_key TEXT NOT NULL,
      message TEXT NOT NULL,
      local_json TEXT,
      exchange_json TEXT,
      FOREIGN KEY (run_id) REFERENCES reconciliation_runs(id) ON DELETE CASCADE
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS user_event_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      boot_id TEXT,
      received_at TEXT NOT NULL,
      operator_address TEXT NOT NULL,
      event_type TEXT NOT NULL,
      entity_key TEXT,
      market TEXT,
      event_timestamp_ms INTEGER,
      is_snapshot INTEGER NOT NULL,
      payload_json TEXT NOT NULL
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS fill_records (
      fill_key TEXT PRIMARY KEY,
      boot_id TEXT,
      operator_address TEXT NOT NULL,
      network TEXT NOT NULL,
      recorded_at TEXT NOT NULL,
      exchange_timestamp_ms INTEGER NOT NULL,
      market_symbol TEXT NOT NULL,
      asset_id INTEGER NOT NULL,
      market_type TEXT NOT NULL,
      order_id INTEGER NOT NULL,
      transaction_id INTEGER NOT NULL,
      side TEXT NOT NULL,
      price TEXT NOT NULL,
      size TEXT NOT NULL,
      start_position TEXT NOT NULL,
      direction TEXT NOT NULL,
      closed_pnl TEXT NOT NULL,
      fee TEXT NOT NULL,
      builder_fee TEXT,
      fee_token TEXT NOT NULL,
      hash TEXT NOT NULL,
      crossed INTEGER NOT NULL,
      is_snapshot INTEGER NOT NULL,
      client_order_id TEXT
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS runtime_state_transitions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      boot_id TEXT,
      changed_at TEXT NOT NULL,
      state TEXT NOT NULL,
      reason TEXT NOT NULL,
      details_json TEXT
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS execution_actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      boot_id TEXT,
      action_id TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      completed_at TEXT,
      action_type TEXT NOT NULL,
      operator_address TEXT NOT NULL,
      signer_address TEXT NOT NULL,
      vault_address TEXT,
      status TEXT NOT NULL,
      trust_state TEXT NOT NULL,
      market_symbol TEXT,
      asset_id INTEGER,
      order_id INTEGER,
      client_order_id TEXT,
      correlation_id TEXT,
      exchange_nonce INTEGER,
      request_json TEXT NOT NULL,
      normalized_request_json TEXT,
      response_json TEXT,
      error_message TEXT
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS risk_event_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      boot_id TEXT,
      occurred_at TEXT NOT NULL,
      action_type TEXT NOT NULL,
      operator_address TEXT NOT NULL,
      trust_state TEXT NOT NULL,
      decision TEXT NOT NULL,
      market_symbol TEXT,
      asset_id INTEGER,
      correlation_id TEXT,
      message TEXT NOT NULL,
      details_json TEXT
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS cloid_mappings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_order_id TEXT NOT NULL UNIQUE,
      action_id TEXT NOT NULL,
      correlation_id TEXT NOT NULL,
      operator_address TEXT NOT NULL,
      market_symbol TEXT NOT NULL,
      asset_id INTEGER NOT NULL,
      order_id INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS order_state_records (
      order_key TEXT PRIMARY KEY,
      operator_address TEXT NOT NULL,
      market_symbol TEXT NOT NULL,
      asset_id INTEGER NOT NULL,
      market_type TEXT NOT NULL,
      state TEXT NOT NULL,
      side TEXT,
      order_id INTEGER,
      client_order_id TEXT,
      limit_price TEXT,
      original_size TEXT,
      filled_size TEXT NOT NULL,
      average_fill_price TEXT,
      last_source TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      event_timestamp_ms INTEGER,
      rejection_reason TEXT,
      metadata_json TEXT
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS order_state_transitions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transition_id TEXT NOT NULL UNIQUE,
      action_id TEXT,
      order_key TEXT NOT NULL,
      operator_address TEXT NOT NULL,
      market_symbol TEXT NOT NULL,
      asset_id INTEGER NOT NULL,
      occurred_at TEXT NOT NULL,
      source TEXT NOT NULL,
      from_state TEXT,
      to_state TEXT NOT NULL,
      order_id INTEGER,
      client_order_id TEXT,
      event_timestamp_ms INTEGER,
      payload_json TEXT
    )
  `,
  "CREATE INDEX IF NOT EXISTS idx_app_events_boot_time ON app_events(boot_id, event_time)",
  "CREATE INDEX IF NOT EXISTS idx_market_events_boot_time ON market_events(boot_id, received_at)",
  "CREATE INDEX IF NOT EXISTS idx_market_events_market_channel_time ON market_events(market, channel, received_at)",
  "CREATE INDEX IF NOT EXISTS idx_asset_registry_snapshots_created_at ON asset_registry_snapshots(created_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_account_snapshots_operator_created_at ON account_snapshots(operator_address, created_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_open_order_runs_operator_created_at ON open_order_snapshot_runs(operator_address, created_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_reconciliation_runs_started_at ON reconciliation_runs(started_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_user_event_records_operator_received_at ON user_event_records(operator_address, received_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_fill_records_operator_time ON fill_records(operator_address, exchange_timestamp_ms DESC)",
  "CREATE INDEX IF NOT EXISTS idx_fill_records_market_time ON fill_records(market_symbol, exchange_timestamp_ms DESC)",
  "CREATE INDEX IF NOT EXISTS idx_fill_records_order_id ON fill_records(order_id)",
  "CREATE INDEX IF NOT EXISTS idx_runtime_state_transitions_changed_at ON runtime_state_transitions(changed_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_execution_actions_created_at ON execution_actions(created_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_execution_actions_client_order_id ON execution_actions(client_order_id)",
  "CREATE INDEX IF NOT EXISTS idx_risk_event_records_occurred_at ON risk_event_records(occurred_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_risk_event_records_operator_occurred_at ON risk_event_records(operator_address, occurred_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_risk_event_records_market_symbol ON risk_event_records(market_symbol, occurred_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_cloid_mappings_market_symbol ON cloid_mappings(market_symbol, updated_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_order_state_records_client_order_id ON order_state_records(client_order_id)",
  "CREATE INDEX IF NOT EXISTS idx_order_state_records_order_id ON order_state_records(order_id)",
  "CREATE INDEX IF NOT EXISTS idx_order_state_transitions_order_key_time ON order_state_transitions(order_key, occurred_at DESC)"
] as const;
