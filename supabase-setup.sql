CREATE TABLE IF NOT EXISTS traders (
  id BIGSERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  cash_balance DECIMAL(18,2) NOT NULL DEFAULT 100000.00,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE traders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_traders" ON traders FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert_traders" ON traders FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_traders" ON traders FOR UPDATE TO anon USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS portfolios (
  id BIGSERIAL PRIMARY KEY,
  trader_id BIGINT NOT NULL REFERENCES traders(id),
  symbol TEXT NOT NULL,
  name TEXT,
  quantity BIGINT NOT NULL DEFAULT 0,
  avg_cost DECIMAL(18,2) NOT NULL DEFAULT 0,
  UNIQUE(trader_id, symbol)
);
ALTER TABLE portfolios ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_all_portfolios" ON portfolios FOR ALL TO anon USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS transactions (
  id BIGSERIAL PRIMARY KEY,
  trader_id BIGINT NOT NULL REFERENCES traders(id),
  symbol TEXT NOT NULL,
  name TEXT,
  type TEXT NOT NULL CHECK (type IN ('buy', 'sell')),
  quantity BIGINT NOT NULL,
  price DECIMAL(18,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_all_transactions" ON transactions FOR ALL TO anon USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS stock_prices (
  symbol TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  base_price DECIMAL(18,2) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO stock_prices (symbol, name, base_price) VALUES
  -- 港股
  ('0005.HK', 'HSBC Holdings', 72.50),
  ('0700.HK', 'Tencent Holdings', 380.00),
  ('9988.HK', 'Alibaba Group', 95.20),
  ('0941.HK', 'China Mobile', 72.35),
  ('1299.HK', 'AIA Group', 65.80),
  ('3690.HK', 'Meituan', 185.50),
  ('1810.HK', 'Xiaomi Corp', 32.45),
  ('2388.HK', 'BOCHK', 28.90),
  ('0001.HK', 'CK Hutchison', 52.60),
  ('0011.HK', 'Hang Seng Bank', 112.30),
  -- 美股
  ('AAPL', 'Apple Inc.', 195.00),
  ('GOOGL', 'Alphabet Inc.', 175.50),
  ('MSFT', 'Microsoft Corp.', 425.00),
  ('TSLA', 'Tesla Inc.', 245.80),
  ('AMZN', 'Amazon.com', 185.30),
  ('NVDA', 'NVIDIA Corp.', 890.00),
  -- A股 (上海)
  ('600519', 'Kweichow Moutai', 1680.00),
  ('600036', 'China Merchants Bank', 36.50),
  ('601318', 'Ping An Insurance', 42.80),
  ('600900', 'Yangtze Power', 26.30),
  ('601166', 'Industrial Bank', 18.90),
  ('600276', 'Hengrui Pharma', 42.50),
  ('601012', 'LONGi Green Energy', 18.60),
  ('600887', 'Yili Group', 28.70),
  ('601398', 'ICBC', 6.80),
  ('600028', 'Sinopec', 6.20),
  ('600030', 'CITIC Securities', 20.50),
  ('600585', 'Conch Cement', 38.60),
  ('600104', 'SAIC Motor', 24.30),
  ('600309', 'Wanhua Chemical', 68.50),
  ('600690', 'Haier Smart Home', 25.80),
  ('600196', 'Fosun Pharma', 35.60),
  ('600570', 'Hundsun Tech', 42.80),
  ('600809', 'Shanxi Fen Wine', 210.00),
  ('600438', 'Tongwei Solar', 38.50),
  ('601688', 'Huatai Sec', 16.80),
  -- A股 (深圳)
  ('000858', 'Wuliangye Yibin', 135.00),
  ('000333', 'Midea Group', 65.80),
  ('000002', 'Vanke A', 9.50),
  ('300750', 'CATL', 210.00),
  ('000651', 'Gree Electric', 42.30),
  ('002415', 'Hikvision', 32.50),
  ('300059', 'East Money Info', 15.80),
  ('002714', 'Muyuan Foods', 38.60),
  ('000001', 'Ping An Bank', 18.60),
  ('300760', 'Mindray Medical', 280.00),
  ('002304', 'Yanghe Brewery', 145.00),
  ('000568', 'Luzhou Laojiao', 225.00),
  ('002230', 'iFlytek', 56.80),
  ('300124', 'Inovance Tech', 68.50),
  ('000063', 'ZTE Corp', 28.90),
  ('002460', 'Ganfeng Lithium', 42.60),
  ('300015', 'Aier Eye Hosp', 32.80),
  ('002475', 'Luxshare Prec', 38.50),
  ('300274', 'Sungrow Power', 88.60),
  ('002352', 'SF Holding', 42.50)
ON CONFLICT (symbol) DO NOTHING;
ALTER TABLE stock_prices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_all_stock_prices" ON stock_prices FOR ALL TO anon USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION register_trader(p_username TEXT, p_password TEXT)
RETURNS TABLE(username TEXT, display_name TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO traders (username, password_hash, display_name, cash_balance)
  VALUES (p_username, p_password, p_username, 100000.00);
  RETURN QUERY SELECT p_username, p_username;
END;
$$;
GRANT EXECUTE ON FUNCTION register_trader TO anon;

CREATE OR REPLACE FUNCTION login_trader(p_username TEXT, p_password TEXT)
RETURNS TABLE(username TEXT, display_name TEXT, cash_balance DECIMAL)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT t.username, t.display_name, t.cash_balance
  FROM traders t
  WHERE t.username = p_username AND t.password_hash = p_password;
END;
$$;
GRANT EXECUTE ON FUNCTION login_trader TO anon;

CREATE OR REPLACE FUNCTION search_stock(p_query TEXT)
RETURNS TABLE(symbol TEXT, name TEXT, price DECIMAL)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_symbol TEXT;
  v_name TEXT;
  v_base DECIMAL;
  v_random DECIMAL;
BEGIN
  FOR v_symbol, v_name, v_base IN
    SELECT sp.symbol, sp.name, sp.base_price
    FROM stock_prices sp
    WHERE sp.symbol ILIKE '%' || p_query || '%' OR sp.name ILIKE '%' || p_query || '%'
    LIMIT 10
  LOOP
    v_random := 1.0 + (random() - 0.5) * 0.1;
    symbol := v_symbol;
    name := v_name;
    price := ROUND(v_base * v_random, 2);
    RETURN NEXT;
  END LOOP;
END;
$$;
GRANT EXECUTE ON FUNCTION search_stock TO anon;

CREATE OR REPLACE FUNCTION execute_trade(
  p_username TEXT, p_symbol TEXT, p_name TEXT,
  p_price DECIMAL, p_quantity BIGINT, p_type TEXT
) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_trader_id BIGINT;
  v_cash DECIMAL(18,2);
  v_cost DECIMAL(18,2);
  v_held BIGINT;
BEGIN
  SELECT t.id, t.cash_balance INTO v_trader_id, v_cash FROM traders t WHERE t.username = p_username;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;

  IF p_type = 'buy' THEN
    v_cost := p_price * p_quantity;
    IF v_cash < v_cost THEN RETURN 'insufficient_funds'; END IF;
    UPDATE traders SET cash_balance = cash_balance - v_cost WHERE id = v_trader_id;
    INSERT INTO portfolios (trader_id, symbol, name, quantity, avg_cost)
    VALUES (v_trader_id, p_symbol, p_name, p_quantity, p_price)
    ON CONFLICT (trader_id, symbol) DO UPDATE SET
      quantity = portfolios.quantity + p_quantity,
      avg_cost = ROUND((portfolios.avg_cost * portfolios.quantity + p_price * p_quantity)::numeric / (portfolios.quantity + p_quantity), 2);
    INSERT INTO transactions (trader_id, symbol, name, type, quantity, price)
    VALUES (v_trader_id, p_symbol, p_name, 'buy', p_quantity, p_price);
    RETURN 'ok';

  ELSIF p_type = 'sell' THEN
    SELECT quantity INTO v_held FROM portfolios WHERE trader_id = v_trader_id AND symbol = p_symbol;
    IF NOT FOUND OR v_held < p_quantity THEN RETURN 'no_shares'; END IF;
    UPDATE traders SET cash_balance = cash_balance + (p_price * p_quantity) WHERE id = v_trader_id;
    UPDATE portfolios SET quantity = quantity - p_quantity
    WHERE trader_id = v_trader_id AND symbol = p_symbol;
    DELETE FROM portfolios WHERE trader_id = v_trader_id AND symbol = p_symbol AND quantity <= 0;
    INSERT INTO transactions (trader_id, symbol, name, type, quantity, price)
    VALUES (v_trader_id, p_symbol, p_name, 'sell', p_quantity, p_price);
    RETURN 'ok';
  END IF;
  RETURN 'invalid_type';
END;
$$;
GRANT EXECUTE ON FUNCTION execute_trade TO anon;

CREATE OR REPLACE FUNCTION get_trader_summary(p_username TEXT)
RETURNS TABLE(cash DECIMAL, market_value DECIMAL, total_pnl DECIMAL)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_trader_id BIGINT;
  v_mv DECIMAL := 0;
  v_pnl DECIMAL := 0;
BEGIN
  SELECT t.id INTO v_trader_id FROM traders t WHERE t.username = p_username;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT COALESCE(SUM(p.quantity * ROUND(sp.base_price * (1.0 + (random() - 0.5) * 0.1), 2)), 0),
         COALESCE(SUM(p.quantity * ROUND(sp.base_price * (1.0 + (random() - 0.5) * 0.1), 2) - p.avg_cost), 0)
  INTO v_mv, v_pnl
  FROM portfolios p
  JOIN stock_prices sp ON sp.symbol = p.symbol
  WHERE p.trader_id = v_trader_id;

  RETURN QUERY SELECT tr.cash_balance, v_mv, v_pnl FROM traders tr WHERE tr.id = v_trader_id;
END;
$$;
GRANT EXECUTE ON FUNCTION get_trader_summary TO anon;

CREATE OR REPLACE FUNCTION get_trader_portfolio(p_username TEXT)
RETURNS TABLE(symbol TEXT, name TEXT, quantity BIGINT, avg_cost DECIMAL, market_price DECIMAL)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_trader_id BIGINT;
  rec RECORD;
BEGIN
  SELECT t.id INTO v_trader_id FROM traders t WHERE t.username = p_username;
  IF NOT FOUND THEN RETURN; END IF;
  FOR rec IN
    SELECT p.symbol, p.name, p.quantity, p.avg_cost, sp.base_price
    FROM portfolios p
    JOIN stock_prices sp ON sp.symbol = p.symbol
    WHERE p.trader_id = v_trader_id AND p.quantity > 0
    ORDER BY p.symbol
  LOOP
    symbol := rec.symbol;
    name := rec.name;
    quantity := rec.quantity;
    avg_cost := rec.avg_cost;
    market_price := ROUND(rec.base_price * (1.0 + (random() - 0.5) * 0.1), 2);
    RETURN NEXT;
  END LOOP;
END;
$$;
GRANT EXECUTE ON FUNCTION get_trader_portfolio TO anon;

CREATE OR REPLACE FUNCTION get_trader_history(p_username TEXT, p_search TEXT DEFAULT NULL)
RETURNS TABLE(symbol TEXT, name TEXT, type TEXT, quantity BIGINT, price DECIMAL, created_at TIMESTAMPTZ, plan_id BIGINT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_trader_id BIGINT;
BEGIN
  SELECT t.id INTO v_trader_id FROM traders t WHERE t.username = p_username;
  IF NOT FOUND THEN RETURN; END IF;
  RETURN QUERY
  SELECT tr.symbol, tr.name, tr.type, tr.quantity, tr.price, tr.created_at, tr.plan_id
  FROM transactions tr
  WHERE tr.trader_id = v_trader_id
    AND (p_search IS NULL OR tr.symbol ILIKE '%' || p_search || '%')
  ORDER BY tr.created_at DESC
  LIMIT 100;
END;
$$;
GRANT EXECUTE ON FUNCTION get_trader_history TO anon;

-- ============ 组合管理（投资组合） ============

CREATE TABLE IF NOT EXISTS trading_plans (
  id BIGSERIAL PRIMARY KEY,
  trader_id BIGINT NOT NULL REFERENCES traders(id),
  plan_name TEXT NOT NULL,
  strategy TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE trading_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_all_trading_plans" ON trading_plans FOR ALL TO anon USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS plan_stocks (
  id BIGSERIAL PRIMARY KEY,
  plan_id BIGINT NOT NULL REFERENCES trading_plans(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  name TEXT,
  UNIQUE(plan_id, symbol)
);
ALTER TABLE plan_stocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_all_plan_stocks" ON plan_stocks FOR ALL TO anon USING (true) WITH CHECK (true);

ALTER TABLE portfolios ADD COLUMN IF NOT EXISTS plan_id BIGINT REFERENCES trading_plans(id) ON DELETE SET NULL;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS plan_id BIGINT REFERENCES trading_plans(id) ON DELETE SET NULL;

DROP FUNCTION IF EXISTS execute_trade(TEXT,TEXT,TEXT,DECIMAL,BIGINT,TEXT);
CREATE OR REPLACE FUNCTION execute_trade(
  p_username TEXT, p_symbol TEXT, p_name TEXT,
  p_price DECIMAL, p_quantity BIGINT, p_type TEXT,
  p_plan_id BIGINT DEFAULT NULL
) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_trader_id BIGINT;
  v_cash DECIMAL(18,2);
  v_cost DECIMAL(18,2);
  v_held BIGINT;
BEGIN
  SELECT t.id, t.cash_balance INTO v_trader_id, v_cash FROM traders t WHERE t.username = p_username;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;

  IF p_type = 'buy' THEN
    v_cost := p_price * p_quantity;
    IF v_cash < v_cost THEN RETURN 'insufficient_funds'; END IF;
    UPDATE traders SET cash_balance = cash_balance - v_cost WHERE id = v_trader_id;
    INSERT INTO portfolios (trader_id, symbol, name, quantity, avg_cost, plan_id)
    VALUES (v_trader_id, p_symbol, p_name, p_quantity, p_price, p_plan_id)
    ON CONFLICT (trader_id, symbol) DO UPDATE SET
      quantity = portfolios.quantity + p_quantity,
      avg_cost = ROUND((portfolios.avg_cost * portfolios.quantity + p_price * p_quantity)::numeric / (portfolios.quantity + p_quantity), 2);
    INSERT INTO transactions (trader_id, symbol, name, type, quantity, price, plan_id)
    VALUES (v_trader_id, p_symbol, p_name, 'buy', p_quantity, p_price, p_plan_id);
    RETURN 'ok';

  ELSIF p_type = 'sell' THEN
    SELECT quantity INTO v_held FROM portfolios WHERE trader_id = v_trader_id AND symbol = p_symbol;
    IF NOT FOUND OR v_held < p_quantity THEN RETURN 'no_shares'; END IF;
    UPDATE traders SET cash_balance = cash_balance + (p_price * p_quantity) WHERE id = v_trader_id;
    UPDATE portfolios SET quantity = quantity - p_quantity
    WHERE trader_id = v_trader_id AND symbol = p_symbol;
    DELETE FROM portfolios WHERE trader_id = v_trader_id AND symbol = p_symbol AND quantity <= 0;
    INSERT INTO transactions (trader_id, symbol, name, type, quantity, price, plan_id)
    VALUES (v_trader_id, p_symbol, p_name, 'sell', p_quantity, p_price, p_plan_id);
    RETURN 'ok';
  END IF;
  RETURN 'invalid_type';
END;
$$;
GRANT EXECUTE ON FUNCTION execute_trade TO anon;

DROP FUNCTION IF EXISTS get_trader_summary(TEXT);
DROP FUNCTION IF EXISTS get_trader_summary(TEXT,BIGINT);
CREATE OR REPLACE FUNCTION get_trader_summary(p_username TEXT, p_plan_id BIGINT DEFAULT NULL)
RETURNS TABLE(cash DECIMAL, market_value DECIMAL, total_pnl DECIMAL)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_trader_id BIGINT;
  v_mv DECIMAL := 0;
  v_pnl DECIMAL := 0;
BEGIN
  SELECT t.id INTO v_trader_id FROM traders t WHERE t.username = p_username;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT COALESCE(SUM(p.quantity * ROUND(sp.base_price * (1.0 + (random() - 0.5) * 0.1), 2)), 0),
         COALESCE(SUM(p.quantity * ROUND(sp.base_price * (1.0 + (random() - 0.5) * 0.1), 2) - p.avg_cost), 0)
  INTO v_mv, v_pnl
  FROM portfolios p
  JOIN stock_prices sp ON sp.symbol = p.symbol
  WHERE p.trader_id = v_trader_id AND p.quantity > 0
    AND (p_plan_id IS NULL OR p.plan_id = p_plan_id);

  IF p_plan_id IS NULL THEN
    RETURN QUERY SELECT tr.cash_balance, v_mv, v_pnl FROM traders tr WHERE tr.id = v_trader_id;
  ELSE
    RETURN QUERY SELECT 0::DECIMAL, v_mv, v_pnl;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION get_trader_summary TO anon;

DROP FUNCTION IF EXISTS get_trader_portfolio(TEXT);
DROP FUNCTION IF EXISTS get_trader_portfolio(TEXT,BIGINT);
CREATE OR REPLACE FUNCTION get_trader_portfolio(p_username TEXT, p_plan_id BIGINT DEFAULT NULL)
RETURNS TABLE(symbol TEXT, name TEXT, quantity BIGINT, avg_cost DECIMAL, market_price DECIMAL, plan_id BIGINT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_trader_id BIGINT;
  rec RECORD;
BEGIN
  SELECT t.id INTO v_trader_id FROM traders t WHERE t.username = p_username;
  IF NOT FOUND THEN RETURN; END IF;
  FOR rec IN
    SELECT p.symbol, p.name, p.quantity, p.avg_cost, sp.base_price, p.plan_id
    FROM portfolios p
    JOIN stock_prices sp ON sp.symbol = p.symbol
    WHERE p.trader_id = v_trader_id AND p.quantity > 0
      AND (p_plan_id IS NULL OR p.plan_id = p_plan_id)
    ORDER BY p.symbol
  LOOP
    symbol := rec.symbol;
    name := rec.name;
    quantity := rec.quantity;
    avg_cost := rec.avg_cost;
    market_price := ROUND(rec.base_price * (1.0 + (random() - 0.5) * 0.1), 2);
    plan_id := rec.plan_id;
    RETURN NEXT;
  END LOOP;
END;
$$;
GRANT EXECUTE ON FUNCTION get_trader_portfolio TO anon;

DROP FUNCTION IF EXISTS create_plan(TEXT,TEXT,TEXT);
CREATE OR REPLACE FUNCTION create_plan(p_username TEXT, p_plan_name TEXT, p_strategy TEXT DEFAULT NULL)
RETURNS TABLE(id BIGINT, plan_name TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_trader_id BIGINT;
  v_result_id BIGINT;
BEGIN
  SELECT t.id INTO v_trader_id FROM traders t WHERE t.username = p_username;
  IF NOT FOUND THEN RETURN; END IF;

  INSERT INTO trading_plans (trader_id, plan_name, strategy)
  VALUES (v_trader_id, p_plan_name, p_strategy);

  SELECT tp.id INTO v_result_id FROM trading_plans tp
  WHERE tp.trader_id = v_trader_id AND tp.plan_name = p_plan_name
  ORDER BY tp.id DESC LIMIT 1;

  id := v_result_id;
  plan_name := p_plan_name;
  RETURN NEXT;
END;
$$;
GRANT EXECUTE ON FUNCTION create_plan TO anon;

CREATE OR REPLACE FUNCTION get_plans(p_username TEXT)
RETURNS TABLE(id BIGINT, plan_name TEXT, strategy TEXT, created_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_tid BIGINT;
BEGIN
  SELECT t.id INTO v_tid FROM traders t WHERE t.username = p_username;
  IF NOT FOUND THEN RETURN; END IF;
  RETURN QUERY SELECT tp.id, tp.plan_name, tp.strategy, tp.created_at FROM trading_plans tp WHERE tp.trader_id = v_tid ORDER BY tp.created_at DESC;
END;
$$;
GRANT EXECUTE ON FUNCTION get_plans TO anon;

CREATE OR REPLACE FUNCTION add_plan_stock(p_plan_id BIGINT, p_symbol TEXT, p_name TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO plan_stocks (plan_id, symbol, name) VALUES (p_plan_id, p_symbol, p_name) ON CONFLICT (plan_id, symbol) DO NOTHING;
  RETURN 'ok';
END;
$$;
GRANT EXECUTE ON FUNCTION add_plan_stock TO anon;

CREATE OR REPLACE FUNCTION remove_plan_stock(p_plan_id BIGINT, p_symbol TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  DELETE FROM plan_stocks WHERE plan_id = p_plan_id AND symbol = p_symbol;
  RETURN 'ok';
END;
$$;
GRANT EXECUTE ON FUNCTION remove_plan_stock TO anon;

CREATE OR REPLACE FUNCTION get_plan_stocks(p_plan_id BIGINT)
RETURNS TABLE(symbol TEXT, name TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY SELECT ps.symbol, ps.name FROM plan_stocks ps WHERE ps.plan_id = p_plan_id ORDER BY ps.symbol;
END;
$$;
GRANT EXECUTE ON FUNCTION get_plan_stocks TO anon;
