// Command example provisions a bucket end to end against a running
// IOLake, then tears it down. It is the Go mirror of the README walkthrough.
//
//	go run ./example -endpoint http://127.0.0.1:9000 -access-key AKIA… -secret-key …
//
// Or with no flags at all, from IOLAKE_URL / IOLAKE_ACCESS_KEY[_FILE] /
// IOLAKE_SECRET_KEY[_FILE].
package main

import (
	"context"
	"flag"
	"fmt"
	"log"

	"github.com/io-lake/iolake-go-sdk"
)

func main() {
	endpoint := flag.String("endpoint", "http://127.0.0.1:9000", "gateway base URL")
	ak := flag.String("access-key", "", "system admin access key")
	sk := flag.String("secret-key", "", "system admin secret key")
	flag.Parse()

	ctx := context.Background()

	// Flags win when given; otherwise fall back to the environment, which is
	// how this runs in a cluster.
	var root *iolake.Client
	var err error
	if *ak != "" && *sk != "" {
		root, err = iolake.New(iolake.Config{Endpoint: *endpoint, AccessKey: *ak, SecretKey: *sk})
	} else {
		root, err = iolake.NewFromEnv()
	}
	if err != nil {
		log.Fatal(err)
	}

	fmt.Println("== as system admin ==")
	if _, err := root.CreateTenant(ctx, iolake.Tenant{Name: "platform", DisplayName: "Platform", Enabled: true}); err != nil && !iolake.IsAlreadyExists(err) {
		log.Fatal(err)
	}
	tenants, err := root.ListTenants(ctx)
	if err != nil {
		log.Fatal(err)
	}
	fmt.Print("  tenants          : ")
	for _, t := range tenants {
		fmt.Print(t.Name, " ")
	}
	fmt.Println()

	prov, err := root.CreateUser(ctx, "csi-provisioner-go", "platform")
	if err != nil {
		log.Fatal(err)
	}
	if err := root.AddTenantAdmin(ctx, "platform", prov.UserID); err != nil {
		log.Fatal(err)
	}
	pk, err := root.CreateAccessKey(ctx, prov.UserID, iolake.CreateAccessKeyInput{})
	if err != nil {
		log.Fatal(err)
	}
	fmt.Printf("  provisioner user : %s\n  provisioner key  : %s scoped=%v\n",
		prov.UserID, pk.AccessKeyID, pk.Scoped())

	fmt.Println("== as the provisioner ==")
	app, err := iolake.New(iolake.Config{Endpoint: *endpoint, AccessKey: pk.AccessKeyID, SecretKey: pk.SecretKey})
	if err != nil {
		log.Fatal(err)
	}
	ba, err := app.ProvisionBucket(ctx, iolake.ProvisionBucketInput{
		Bucket:            "app-go",
		ProvisionerUserID: prov.UserID,
	})
	if err != nil {
		log.Fatal(err)
	}
	fmt.Printf("  bucket access    : bucket=%s key=%s scope=%s\n", ba.Bucket, ba.AccessKeyID, ba.Scope)

	buckets, err := app.ListBuckets(ctx)
	if err != nil {
		log.Fatal(err)
	}
	fmt.Print("  buckets it sees  : ")
	for _, b := range buckets {
		fmt.Printf("%s(owner %.8s) ", b.Name, b.Owner)
	}
	fmt.Println()

	fmt.Println("== the bucket credential is confined ==")
	bc, err := iolake.New(iolake.Config{Endpoint: *endpoint, AccessKey: ba.AccessKeyID, SecretKey: ba.SecretKey})
	if err != nil {
		log.Fatal(err)
	}
	if _, err := bc.ListBuckets(ctx); err == nil {
		fmt.Println("  management API   : ALLOWED  <-- would be a bug")
	} else {
		fmt.Printf("  management API   : refused, forbidden=%v\n    %v\n", iolake.IsForbidden(err), err)
	}

	fmt.Println("== deprovision ==")
	if err := app.DeprovisionBucket(ctx, prov.UserID, "app-go"); err != nil {
		log.Fatal(err)
	}
	left, _ := app.ListBuckets(ctx)
	fmt.Printf("  buckets now      : %d\n", len(left))

	// tidy up the provisioner itself
	_ = root.DeleteAccessKey(ctx, pk.AccessKeyID)
	_ = root.DeleteUser(ctx, prov.UserID)
}
