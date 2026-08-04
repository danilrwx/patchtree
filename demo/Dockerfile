FROM golang:1.24 AS build
WORKDIR /src
COPY . .
RUN go build -o /out/inventory ./...

FROM gcr.io/distroless/static
COPY --from=build /out/inventory /inventory
ENTRYPOINT ["/inventory"]
