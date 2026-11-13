# The GeoLift job for the Awareness tab: R + GeoLift (GitHub) + a small Python
# helper that moves files to and from the dashboard's bucket. It reads the
# panels the Awareness job wrote (cache/awareness/panel_*.csv) and writes its
# results back next to them (cache/awareness/geolift/). No BigQuery access.
FROM rocker/r-ver:4.4.1

RUN apt-get update && apt-get install -y --no-install-recommends \
      libcurl4-openssl-dev libssl-dev libxml2-dev libfontconfig1-dev libfreetype6-dev \
      libpng-dev libharfbuzz-dev libfribidi-dev libgit2-dev cmake python3 python3-pip \
    && rm -rf /var/lib/apt/lists/*
RUN pip3 install --no-cache-dir --break-system-packages google-cloud-storage==2.18.2
# pinned to the CRAN snapshot rocker uses; GeoLift and augsynth from GitHub
RUN R -q -e "install.packages(c('remotes','jsonlite','dplyr','tidyr','doParallel','foreach','ggplot2'))" \
 && R -q -e "remotes::install_github('ebenmichael/augsynth', upgrade = 'never')" \
 && R -q -e "remotes::install_github('facebookincubator/GeoLift', upgrade = 'never')" \
 && R -q -e "library(GeoLift); library(augsynth)"

WORKDIR /app
COPY gcs_io.py geolift.R run.sh ./
RUN chmod +x run.sh
ENTRYPOINT ["/app/run.sh"]
CMD ["weekly"]
