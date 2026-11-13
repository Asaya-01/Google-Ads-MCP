# GeoLift for the Awareness tab. Rscript geolift.R weekly|monthly
#
# Inputs (written by the Awareness job, downloaded by gcs_io.py into $WORK):
#   panel_state.csv, panel_city.csv  date, location, Y, units, orders, d2c_new_customers
#                                    (dense, zero-filled, lowercase locations)
#   r_input.json                     tests (with the donor rule already applied),
#                                    eligible geos, geos excluded for contamination
#   prev_tests.json                  earlier runs, kept as run history
# Outputs ($WORK/out): tests.json, testability.json, power_curves.json, plots/*.png
#
# Every lift is a FLOOR: Nykaa, Amazon 1P (RK Worldinfocom) and B2B have no
# customer geo and are not in the panels. Interim results are never called
# significant. No model other than GeoLift's synthetic control is involved.

suppressPackageStartupMessages({
  library(GeoLift)
  library(dplyr)
  library(jsonlite)
})

args <- commandArgs(trailingOnly = TRUE)
mode <- if (length(args) > 0) args[1] else "weekly"
work <- Sys.getenv("WORK", "/work")
out_dir <- file.path(work, "out")
dir.create(file.path(out_dir, "plots"), recursive = TRUE, showWarnings = FALSE)

inp <- fromJSON(file.path(work, "r_input.json"), simplifyVector = FALSE)
gl <- inp$geolift
effects <- unlist(gl$effect_sizes)
periods <- unlist(gl$treatment_periods)
alpha <- gl$alpha
as_of <- as.Date(inp$as_of)
floor_note <- inp$floor_note
run_date <- as.character(Sys.Date())

panels <- list(
  state = read.csv(file.path(work, "panel_state.csv"), stringsAsFactors = FALSE),
  city = read.csv(file.path(work, "panel_city.csv"), stringsAsFactors = FALSE)
)
for (lv in names(panels)) {
  panels[[lv]]$location <- tolower(panels[[lv]]$location)
  panels[[lv]]$date <- as.Date(panels[[lv]]$date)
}

# one KPI column as GeoLift data, between two dates; returns the data and the date of each time index
geo_data <- function(level, kpi, locs, from, to) {
  d <- panels[[level]]
  d <- d[d$location %in% locs & d$date >= from & d$date <= to, c("date", "location", kpi)]
  names(d)[3] <- "Y"
  d$date <- format(d$date, "%Y-%m-%d")
  g <- GeoDataRead(data = d, date_id = "date", location_id = "location", Y_id = "Y", format = "yyyy-mm-dd", summary = FALSE)
  dates <- sort(unique(as.Date(d$date)))
  list(data = g, dates = dates)
}

# power curve and MDE (smallest effect with average power >= target) per duration
power_curve <- function(pw) {
  pw %>% group_by(duration, EffectSize) %>% summarise(power = mean(power), .groups = "drop") %>% arrange(duration, EffectSize)
}
mde_of <- function(curve, dur) {
  x <- curve[curve$duration == dur & curve$EffectSize > 0 & curve$power >= gl$power_target, ]
  if (nrow(x) == 0) NA else min(x$EffectSize)
}

safe <- function(expr, what) {
  tryCatch(expr, error = function(e) { message(what, " failed: ", conditionMessage(e)); NULL })
}

# ---------------------------------------------------------------- 5a testability (monthly)
if (mode == "monthly") {
  scan_end <- as_of
  scan_start <- scan_end - gl$pre_days + 1
  rows <- list(); curves <- list()
  for (level in c("state", "city")) {
    eligible <- unlist(inp$eligible[[level]])
    contaminated <- unlist(inp$excluded_for_scan[[level]])
    city_state <- if (level == "city") inp$city_state else NULL  # for the same-state spillover rule
    for (loc in eligible) {
      donors <- setdiff(eligible, c(loc, contaminated))
      if (level == "city" && !is.null(city_state[[loc]])) {
        same <- names(city_state)[unlist(city_state) == city_state[[loc]]]
        donors <- setdiff(donors, same)
      }
      if (length(donors) < 5) next
      gd <- safe(geo_data(level, "Y", c(loc, donors), scan_start, scan_end), paste("data", loc))
      if (is.null(gd)) next
      pw <- safe(GeoLiftPower(data = gd$data, locations = loc, effect_size = effects, lookback_window = gl$lookback_window,
                              treatment_periods = periods, side_of_test = "one_sided", alpha = alpha,
                              parallel = TRUE, parallel_setup = "sequential", fixed_effects = TRUE), paste("power", loc))
      if (is.null(pw)) next
      cv <- power_curve(as.data.frame(pw))
      base <- mean(panels[[level]]$Y[panels[[level]]$location == loc & panels[[level]]$date >= scan_end - 83 & panels[[level]]$date <= scan_end]) * 7
      avg_daily <- mean(panels[[level]]$Y[panels[[level]]$location == loc & panels[[level]]$date >= scan_start & panels[[level]]$date <= scan_end])
      m28 <- mde_of(cv, 28); m42 <- mde_of(cv, 42)
      rows[[length(rows) + 1]] <- list(scan_date = run_date, geo_level = level, location = loc, avg_daily_sales = round(avg_daily, 2),
                                       weekly_baseline = round(base, 2), mde_28d = m28, mde_42d = m42,
                                       min_weekly_spend_to_detect_at_iroas_0.5 = if (is.na(m42)) NA else round(m42 * base / 0.5),
                                       donors = length(donors))
      curves[[paste(level, loc, sep = "|")]] <- lapply(split(cv, cv$duration), function(x) unname(as.matrix(x[, c("EffectSize", "power")])))
    }
  }
  write_json(list(scan_date = run_date, rows = rows), file.path(out_dir, "testability.json"), auto_unbox = TRUE, na = "null", digits = 6)
  write_json(list(scan_date = run_date, curves = curves), file.path(out_dir, "power_curves.json"), auto_unbox = TRUE, na = "null", digits = 6)
  quit(save = "no", status = 0)
}

# ---------------------------------------------------------------- 5b tests (weekly)
prev <- if (file.exists(file.path(work, "prev_tests.json"))) fromJSON(file.path(work, "prev_tests.json"), simplifyVector = FALSE) else list(tests = list())
out <- list(tests = list())

for (t in inp$tests) {
  if (!(t$status %in% c("planned", "active", "done"))) next
  level <- t$geo_level
  treat <- tolower(unlist(t$treatment_locations))
  incl <- Filter(function(d) isTRUE(d$included), t$donors)
  donors <- vapply(incl, function(d) d$location, "")
  pre_start <- as.Date(t$pre_start); pre_end <- as.Date(t$pre_end)
  test_start <- as.Date(t$test_start); test_end <- as.Date(t$test_end)
  history <- if (!is.null(prev$tests[[t$test_id]])) prev$tests[[t$test_id]]$results else list()
  entry <- list(results = list(), series = list(), donors = list())
  # weekly spend lives in the private settings; without it there is no budget, plausible lift or iROAS
  ws <- if (is.null(t$weekly_spend)) NA_real_ else as.numeric(t$weekly_spend)
  run_id <- paste(t$test_id, run_date, sep = "@")

  for (kpi in c("Y", "d2c_new_customers")) {
    # --- power on the pre-period
    gd_pre <- safe(geo_data(level, kpi, c(treat, donors), max(pre_start, pre_end - gl$pre_days + 1), pre_end), "pre data")
    if (is.null(gd_pre)) next
    pw <- safe(GeoLiftPower(data = gd_pre$data, locations = treat, effect_size = effects, lookback_window = gl$lookback_window,
                            treatment_periods = periods, side_of_test = "one_sided", alpha = alpha,
                            parallel = TRUE, parallel_setup = "sequential", fixed_effects = TRUE), "test power")
    m28 <- NA; m42 <- NA
    if (!is.null(pw)) { cv <- power_curve(as.data.frame(pw)); m28 <- mde_of(cv, 28); m42 <- mde_of(cv, 42) }
    ms <- if (kpi == "Y") safe(GeoLiftMarketSelection(data = gd_pre$data, treatment_periods = periods, N = length(treat),
                                                     include_markets = treat, effect_size = effects, lookback_window = gl$lookback_window,
                                                     cpic = 1 / t$expected_iroas, budget = if (is.na(ws)) NULL else ws * 6, alpha = alpha,
                                                     fixed_effects = TRUE, Correlations = TRUE, side_of_test = "one_sided",
                                                     parallel = TRUE, parallel_setup = "sequential", print = FALSE), "market selection") else NULL
    pre_y <- panels[[level]][panels[[level]]$location %in% treat & panels[[level]]$date > pre_end - 84 & panels[[level]]$date <= pre_end, ]
    weekly_base <- sum(pre_y[[kpi]]) / 12
    plausible <- if (kpi == "Y" && weekly_base > 0) ws * t$expected_iroas / weekly_base else NA
    corr <- NA
    if (!is.null(ms) && !is.null(ms$BestMarkets$correlation)) corr <- ms$BestMarkets$correlation[1]
    history[[length(history) + 1]] <- list(run_id = run_id, run_date = run_date, test_id = t$test_id, kpi = kpi, run_type = "power",
      mde_28d = m28, mde_42d = m42, plausible_lift = plausible, underpowered_flag = isTRUE(!is.na(plausible) && !is.na(m42) && plausible < m42),
      donor_count = length(donors), donor_correlation = corr, notes = floor_note)

    # --- readout: weekly interim while running, final once test_end has passed
    if (as_of < test_start + 6) next
    end <- min(as_of, test_end)
    gd <- safe(geo_data(level, kpi, c(treat, donors), pre_start, end), "test data")
    if (is.null(gd)) next
    t0 <- which(gd$dates == test_start); t1 <- which(gd$dates == end)
    res <- safe(GeoLift(Y_id = "Y", data = gd$data, locations = treat, treatment_start_time = t0, treatment_end_time = t1,
                        model = "best", fixed_effects = TRUE, ConfidenceIntervals = TRUE, alpha = alpha), "GeoLift")
    if (is.null(res)) next
    run_type <- if (as_of >= test_end) "final" else "interim"
    inf <- res$inference
    n <- length(treat)
    # the treatment total each day, and its counterfactual (GeoLift predicts the average treated location)
    act <- panels[[level]] %>% filter(location %in% treat, date >= pre_start, date <= end) %>% group_by(date) %>% summarise(v = sum(.data[[kpi]]), .groups = "drop") %>% arrange(date)
    yhat <- as.numeric(res$y_hat) * n
    att <- res$summary$att
    lo <- if (!is.null(att$lower_bound)) act$v - as.numeric(att$upper_bound) * n else rep(NA, nrow(act))
    hi <- if (!is.null(att$upper_bound)) act$v - as.numeric(att$lower_bound) * n else rep(NA, nrow(act))
    entry$series[[kpi]] <- list(run_id = run_id, dates = format(act$date, "%Y-%m-%d"), actual = round(act$v, 2), counterfactual = round(yhat, 2),
                                ci_low = round(lo, 2), ci_high = round(hi, 2), test_start = t$test_start)
    days_in <- as.numeric(end - test_start) + 1
    spend <- ws * days_in / 7
    cf_total <- sum(yhat[act$date >= test_start])
    # donor drift: each donor's test-period actual against its own pre-period linear trend, weighted by GeoLift weight
    w <- res$df_weights
    drift <- NA
    dd <- panels[[level]] %>% filter(location %in% donors, date > pre_end - 84, date <= end)
    if (nrow(dd) > 0) {
      parts <- lapply(donors, function(l) {
        x <- dd[dd$location == l, ]
        pre <- x[x$date <= pre_end, ]; post <- x[x$date >= test_start, ]
        if (nrow(pre) < 28 || nrow(post) == 0) return(NULL)
        fit <- lm(v ~ tt, data = data.frame(v = pre[[kpi]], tt = as.numeric(pre$date)))
        expct <- sum(pmax(predict(fit, newdata = data.frame(tt = as.numeric(post$date))), 0))
        ww <- if (l %in% w$location) w$weight[w$location == l] else 0
        c(actual = sum(post[[kpi]]), expected = expct, weight = max(ww, 0))
      })
      parts <- do.call(rbind, Filter(Negate(is.null), parts))
      if (!is.null(parts) && nrow(parts) > 0) {
        ww <- if (sum(parts[, "weight"]) > 0) parts[, "weight"] else rep(1, nrow(parts))
        drift <- sum(ww * parts[, "actual"]) / sum(ww * parts[, "expected"]) - 1
      }
    }
    if (kpi == "Y") {
      # GeoLift's donor weights; the pre-period correlations come from the Awareness job
      entry$donors <- lapply(seq_len(nrow(w)), function(i) list(location = w$location[i], weight = round(w$weight[i], 5)))
      png(file.path(out_dir, "plots", paste0(t$test_id, "_lift.png")), width = 1200, height = 700); print(plot(res, type = "Lift")); dev.off()
      png(file.path(out_dir, "plots", paste0(t$test_id, "_att.png")), width = 1200, height = 700); print(plot(res, type = "ATT")); dev.off()
    }
    history[[length(history) + 1]] <- list(run_id = run_id, run_date = run_date, test_id = t$test_id, kpi = kpi, run_type = run_type,
      mde_28d = m28, mde_42d = m42, plausible_lift = plausible, underpowered_flag = isTRUE(!is.na(plausible) && !is.na(m42) && plausible < m42),
      donor_count = length(donors), donor_correlation = corr, donor_drift_pct = drift,
      lift_pct = inf$Perc.Lift[1] / 100, incremental_sales = res$incremental, p_value = inf$pvalue[1],
      ci_low = res$lower_bound, ci_high = res$upper_bound,
      lift_ci_low = if (cf_total > 0) res$lower_bound / cf_total else NA, lift_ci_high = if (cf_total > 0) res$upper_bound / cf_total else NA,
      spend_in_window = spend, iroas = if (kpi == "Y") res$incremental / spend else NA,
      iroas_ci_low = if (kpi == "Y") res$lower_bound / spend else NA, iroas_ci_high = if (kpi == "Y") res$upper_bound / spend else NA,
      notes = paste0(floor_note, if (run_type == "interim") " Interim: never significant before the test ends." else ""))
  }
  entry$results <- history
  out$tests[[t$test_id]] <- entry
}
write_json(out, file.path(out_dir, "tests.json"), auto_unbox = TRUE, na = "null", digits = 8, null = "null")
